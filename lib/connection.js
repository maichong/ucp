/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const dgram = require('dgram');
const net = require('net');
const dns = require('dns');
const EventEmitter = require('events');
const Stream = require('./stream');
const Packet = require('./packet');
const Bus = require('./bus');
const CMD = require('./cmd');
const config = require('./config');

const UCP_CONN_TIMEOUT = config('UCP_CONN_TIMEOUT', 5000, 'int');
const UCP_CONN_PING_TIMER = config('UCP_CONN_PING_TIMER', 5000, 'int');
const UCP_CONN_ALIVE_TIMEOUT = config('UCP_CONN_ALIVE_TIMEOUT', 10000, 'int');
const UCP_CONN_NO_BUS_SIZE = config('UCP_CONN_NO_BUS_SIZE', 1000, 'int');
const UCP_CONN_RTO_MIN = config('UCP_CONN_NO_BUS_SIZE', 50, 'int');
const UCP_CONN_RTO_MAX = config('UCP_CONN_RTO_MAX', 500, 'int');

module.exports = class Connection extends EventEmitter {

  constructor(options, connectionListener) {
    super();
    this.encryption = options.encryption;
    this.autoClose = options.autoClose !== false;
    this.remotePort = options.port;
    this.remoteAddress = options.host || options.address || '127.0.0.1';
    this._connectionListener = connectionListener;// 新Stream回调函数
    this.incoming = false;
    this.connected = false; //客户端已经连接
    this._connectTimer = 0;  //客户端连接超时
    this._departureTimer = 0; //数据包发送延迟
    this.streams = {};
    this.streamsCount = 0;//建立的链接数量
    this.closed = false;//是否已经关闭
    this.bytesRead = 0;
    this.bytesWritten = 0;
    this._pingTimer = 0;
    this.srtt = 100;
    this.rto = 100;
    this.lastAlive = 0;

    //bus send queue
    this.queue = [];
  }

  connect() {
    //console.log('connect...');
    this._connectTimer = setTimeout(() => {
      this.emit('timeout');
      this.emit('error', new Error('connect timeout'));
    }, UCP_CONN_TIMEOUT);
    if (net.isIPv4(this.remoteAddress)) {
      return this._connect();
    } else {
      dns.lookup(this.remoteAddress, (error, address) => {
        if (error) {
          return this.emit('error', error);
        }
        this.remoteAddress = address;
        this._connect();
      });
    }
  }

  _connect() {
    if (!this.socket) {
      this.socket = dgram.createSocket('udp4');
      this.socket.bind(() => {
        let addr = this.socket.address();
        this.localAddress = addr.address;
        this.localPort = addr.port;
        this._send(new Packet(CMD.CONNECT));
      });

      //客户端收到服务器发来的数据
      this.socket.on('message', (msg, rinfo) => {
        //console.log('msg', msg, rinfo);
        if (rinfo.address != this.remoteAddress || rinfo.port != this.remotePort) {
          return;
        }
        try {
          msg = this.encryption.decrypt(msg);
          if (msg[0] !== 0xAA) return;
          msg = msg.slice(1);
        } catch (e) {
          return;
        }
        this.bytesRead += msg.length;
        let packets = Bus.parse(msg);
        if (!packets.length) {
          return;
        }
        packets.forEach(packet => this.receive(packet));
      });
    }
  }

  _onConnected() {
    //console.log('_onConnected');
    if (!this.connected) {
      this.connected = true;
      clearTimeout(this._connectTimer);
      this.emit('connect');
      this.ping();
      this._pingTimer = setInterval(() => {
        if (Date.now() - this.lastAlive > UCP_CONN_ALIVE_TIMEOUT) {
          this.close();
        } else {
          this.ping();
        }
      }, UCP_CONN_PING_TIMER);
    }
  }

  close() {
    if (this.closed) return;
    //console.log('close connection');
    //将队列中所有bus发出
    this.departure(true);
    clearInterval(this._pingTimer);
    clearInterval(this._departureTimer);
    for (let key in this.streams) {
      if (!this.streams.hasOwnProperty(key)) {
        return;
      }
      let stream = this.streams[key];
      stream.destroy();
      delete this.streams[key];
      this.streamsCount--;
    }
    if (this.socket) {
      let buffer = new Buffer(1);
      buffer.writeInt8(CMD.CLOSE, 0);
      this._send(new Packet(buffer));
      if (!this.incoming) {
        //如果是客户端,则关闭socket
        let socket = this.socket;
        setTimeout(() => {
          socket.close();
        }, 100);
      }
      this.closed = true;
      delete this.socket;
    }
    this.emit('close');
  }

  ping() {
    let buffer = new Buffer(9);
    buffer.writeUInt8(CMD.PING);
    buffer.writeDoubleLE(Date.now(), 1);
    this._send(new Packet(buffer));
  }

  createStream(id) {
    if (this.closed) return;
    let streamId = id || parseInt(Math.random() * Stream.maxId);
    let stream = new Stream(streamId, this);
    this.streams[streamId] = stream;
    this.streamsCount++;
    stream.on('close', () => {
      setTimeout(() => {
        if (this.streams[streamId]) {
          delete this.streams[streamId];
          this.streamsCount--;
        }
        if (this.streamsCount < 1 && !this.incoming && this.autoClose) {
          //如果是客户端,并且已经没有有效的流
          //关闭链接
          this.close();
        }
      }, 100);
    });
    return stream;
  }

  send(packet) {
    //console.log('connection.send');
    if (this.closed) return;
    //如果能够搭乘Bus
    if (this.queue.find(bus => bus.ride(packet))) {
      return;
    }

    if (packet.buffer.length > UCP_CONN_NO_BUS_SIZE) {
      this._send(packet);
      return;
    }

    let bus = new Bus(packet);
    this.queue.push(bus);

    if (!this._departureTimer) {
      this.departure();
      this._departureTimer = setTimeout(() => {
        this.departure();
      }, 1);
    }
  }

  /**
   * @param {boolean} [all]
   */
  departure(all) {
    if (this.closed) return;
    let now = Date.now();
    while (this.queue.length) {
      let bus = this.queue[0];
      if (!all && bus.departure > now) {
        break;
      }
      let packet = bus.getData();
      this._send(packet);
      this.queue.shift();
    }
    if (!this.queue.length) {
      this._departureTimer = 0;
    } else {
      this._departureTimer = setTimeout(() => {
        this.departure();
      }, 1);
    }
  }

  /**
   * 立即发送
   * @param packet
   * @private
   */
  _send(packet) {
    //console.log('connection._send');
    //console.trace();
    if (this.closed || !packet) {
      return;
    }
    let buffer = packet.buffer;
    //console.log('send', buffer);
    let data = new Buffer(buffer.length + 1);
    data.writeUInt8(0xAA);
    buffer.copy(data, 1);
    data = this.encryption.encrypt(data);
    //console.log('send', buffer);
    this.socket.send(data, 0, data.length, this.remotePort, this.remoteAddress);
    this.bytesWritten += data.length;
  }

  /**
   * 接收
   * @param packet
   */
  receive(packet) {
    //console.log('receive', packet.buffer);
    if (this.closed) return;
    this.lastAlive = Date.now();
    let cmd = packet.cmd;
    //console.log('receive packet', packet.buffer);
    if (cmd === CMD.CONNECT) {
      this._send(new Packet(CMD.CONNECTED));
      this._onConnected();
      return;
    }
    if (cmd === CMD.CONNECTED) {
      this._onConnected();
      return;
    }
    if (cmd === CMD.CLOSE) {
      this.close();
      return;
    }

    if (cmd === CMD.PING) {
      packet.buffer.writeUInt8(CMD.PONG);
      //console.log('pong');
      this._send(packet);
      return;
    }

    if (cmd === CMD.PONG) {
      let time = Date.now() - packet.buffer.readDoubleLE(1);
      if (time < 1 || time > 2000) {
        return;
      }
      this.srtt = 0.8 * this.srtt + 0.2 * time;
      this.rto = Math.min(UCP_CONN_RTO_MAX, Math.max(UCP_CONN_RTO_MIN, 1.6 * this.srtt));
      //console.log('srtt', this.srtt, 'rto', this.rto);
      return;
    }

    if (cmd === CMD.CONFIRM || cmd === CMD.CLOSE_STREAM) {
      let streamId = packet.streamId;
      let stream = this.streams[streamId];
      if (!stream) {
        return;
      }
      try {
        stream.receive(packet);
      } catch (e) {
        console.log(e.stack);
      }
    }

    //收到的为Data
    if (cmd % 2) {
      if (packet.streamId > Stream.maxId) {
        return;
      }
      let streamId = packet.streamId;
      let stream = this.streams[streamId];
      if (!stream) {
        //服务器端收到新的Stream
        if (!this.incoming) {
          return;
        }
        stream = this.streams[streamId] = this.createStream(streamId);
        if (this._connectionListener) {
          try {
            this._connectionListener(stream);
          } catch (err) {
          }
        }

      }
      stream.receiveData(packet);
      return;
    }

    //else
  }

};
