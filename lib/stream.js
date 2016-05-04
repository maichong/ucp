/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const EventEmitter = require('events');
const Segment = require('./segment');
const Packet = require('./packet');
const CMD = require('./cmd');

const CONFIRM = 4;

const LBOUND = 50; //RTO 最小值
const UBOUND = 500;  //RTO 最大值

class Stream extends EventEmitter {
  constructor(id, connection) {
    super();
    this.id = id;
    this.connection = connection;
    this.sentMaxSegmentId = 0; //发送方,发送的最大Segment ID
    this.successMaxSegmentId = 0; //发送方,确认发送成功的最大Segment ID
    this.receivedMaxSegmentId = 0; //接收方,已经收到的最大Segment ID
    this.confirmedMaxSegmentId = 0; //接收方,已经确认的最大Segment ID
    this.received = {}; // 接收的 Segment 缓冲
    this.receivedLength = 0;
    this.confirmTimer = 0;//确认Timer
    this.lastAlive = Date.now();
    this.sent = {};//发送端,已经发送,待确认的Segment
    this.sentLength = 0;
    this.bytesRead = 0;
    this.bytesWritten = 0;
    this.remoteAddress = connection.remoteAddress;
    this.remotePort = connection.remotePort;
    this._writeQueue = [];
    this.writeTimer = 0;
    this.resentPacketCount = 0;
    this.resentPacketCountAuto = 0;
    this.resentPacketCountConfirm = 0;
    this._resend = {}; //重新发送列表
    this.closed = false;
    this.srtt = 100;

    this._aliveTimer = setInterval(() => {
      let now = Date.now();
      if (now - this.lastAlive > 300000) {
        //5分钟不活跃
        this.close();
        return;
      }
      if (this.receivedLength && now - this.lastAlive > 5000) {
        //5秒内不活跃,并且有需要重发的包
        //请求重发
        this._confirm();
        return;
      }
    }, 5000);

    this._autoResendTimer = setInterval(() => {
      let now = Date.now();
      let rto = this.connection.rto * 10;
      for (let i in this.sent) {
        let segment = this.sent[i];
        //TODO RTT
        if (!this._resend[segment.id] && now - segment.lastSent > rto * 2) {
          segment.lastSent = now;
          segment.sack = 0;
          this._resend[segment.id] = segment;
          this.resentPacketCountAuto++;
        }
      }
      if (!this.confirmTimer && this.receivedLength) {
        this.confirmTimer = setTimeout(() => {
          this.confirmTimer = 0;
          this._confirm();
        }, 1);
      }
    }, 20);

    this._resendQueueTimer = setInterval(() => {
      let now = Date.now();
      for (let id in this._resend) {
        let segment = this._resend[id];
        delete this._resend[id];
        if (segment.a && !segment.a.onBus) {
          this.connection.send(segment.a);
          this.resentPacketCount++;
        }
        if (segment.b && !segment.b.onBus) {
          this.connection.send(segment.b);
          this.resentPacketCount++;
        }
        if (segment.c && !segment.c.onBus) {
          this.connection.send(segment.c);
          this.resentPacketCount++;
        }
        if (segment.p && !segment.p.onBus) {
          this.connection.send(segment.p);
          this.resentPacketCount++;
        }
        segment.lastSent = now;
        segment.sack = 0;
      }
    }, 2);
  }

  close() {
    //console.log('stream', this.id, 'close');
    if (this.connection) {
      this.emit('close');
      let buffer = new Buffer(4);
      buffer.writeUInt8(CMD.CLOSE_STREAM);
      this.idBuffer.copy(buffer, 1);
      let packet = new Packet(buffer);
      this.connection._send(packet);
    }
    this.closed = true;
    delete this._idBuffer;
    delete this.received;
    delete this.sent;
    delete this.connection;
    delete this._writeQueue;
    if (this.confirmTimer) {
      clearTimeout(this.confirmTimer);
    }
    clearInterval(this._aliveTimer);
    clearInterval(this._autoResendTimer);
    clearInterval(this._resendQueueTimer);
  }

  get idBuffer() {
    if (!this._idBuffer) {
      this._idBuffer = Stream.idToBuffer(this.id);
    }
    return this._idBuffer;
  }

  static idToBuffer(id) {
    let tmp = new Buffer(4);
    let buffer = new Buffer(3);
    tmp.writeInt32LE(id, 0);
    tmp.copy(buffer, 0, 0, 3);
    return buffer;
  }

  static bufferToId(buffer) {
    let tmp = new Buffer(4);
    tmp.fill(0, 3);
    buffer.copy(tmp);
    return tmp.readInt32LE(0);
  }

  /**
   * @param data
   * @param [encoding]
   * @param [callback]
   */
  write(data, encoding, callback) {
    if (this.closed) {
      return;
    }
    if (!data || !data.length) {
      return;
    }
    if (typeof data === 'string') {
      data = new Buffer(data, encoding);
    }

    //如果一次写入的数据大于单个包最大数据
    //拆开写入多次
    if (data.length > 4350) {
      for (let start = 0; start < data.length; start += 4350) {
        let end = start + 4350;
        if (end > data.length) {
          end = data.length;
        }
        this._writeQueue.push(data.slice(start, end));
      }
    } else {
      this._writeQueue.push(data);
    }
    if (!this.writeTimer) {
      this._write();
    }
  }

  _write() {
    if (this.closed) {
      return;
    }
    this.writeTimer = 0;
    if (!this._writeQueue.length) {
      return;
    }
    let rto = this.connection.rto;
    if (this.sentLength > rto * 5) {
      this.writeTimer = setTimeout(() => this._write(), 2);
      return;
    }
    let data = this._writeQueue.shift();
    if (!data) {
      return;
    }
    this.bytesWritten += data.length;
    this.sentMaxSegmentId++;
    let segment = new Segment(this.sentMaxSegmentId, this, data);
    segment.pack();
    segment.lastSent = Date.now();
    this.connection.send(segment.a);
    this.connection.send(segment.b);
    this.connection.send(segment.c);
    this.connection.send(segment.p);
    this.sent[segment.id] = segment;
    this.sentLength++;
    if (this.sentLength < rto * 2) {
      this._write();
    } else {
      this.writeTimer = setTimeout(() => this._write(), parseInt(rto / 100));
    }
  }

  /**
   * 当收到Packet
   * @param packet
   */
  receive(packet) {
    this.lastAlive = Date.now();

    if (packet.cmd === CMD.CONFIRM) {
      this._receiveSACK(packet);
    }
  }

  _receiveSACK(packet) {
    if (this.closed) {
      return;
    }
    const now = Date.now();
    let segmentId = packet.segmentId;
    for (let i = this.successMaxSegmentId + 1; i <= packet.segmentId; i++) {
      if (this.sent[i]) {
        let time = now - this.sent[i].createdAt;
        this.srtt = 0.9 * this.srtt + 0.1 * time;
        //this.srtt = Math.min(UBOUND, Math.max(LBOUND, this.srtt));
        this.sentLength--;
        delete this.sent[i];
        delete this._resend[i];
        //console.log('receive.remove', i);
      }
    }
    //console.log('confirm', segmentId - this.successMaxSegmentId);
    this.successMaxSegmentId = segmentId;

    //SACK
    let buffer = packet.buffer;
    let index = 8;
    let lastSegmentId = segmentId;
    while (buffer.length > index) {
      let offset = buffer.readUInt8(index);
      if (!offset) {
        throw new Error('offset ' + offset);
      }
      let code = buffer.readUInt8(index + 1);
      index += 2;
      let id = segmentId + offset;
      let segment = this.sent[id];
      if (!segment) {
        console.error('error , can not resend ', id);
        this.close();
        return;
      }
      while (id - lastSegmentId > 1) {
        lastSegmentId++;
        //中间有一些已经接收到了
        if (this.sent[lastSegmentId]) {
          let time = now - this.sent[lastSegmentId].createdAt;
          this.srtt = 0.9 * this.srtt + 0.1 * time;
          //this.srtt = Math.min(UBOUND, Math.max(LBOUND, this.srtt));
          this.sentLength--;
          delete this.sent[lastSegmentId];
          //console.log('remove', lastSegmentId);
        }
        //console.log(lastSegmentId, id);
      }
      lastSegmentId = id;

      if (segment.a && code % CMD.DATA_A !== 0) {
        delete segment.a;
        segment.count--;
      }

      if (segment.b && code % CMD.DATA_B !== 0) {
        delete segment.b;
        segment.count--;
      }

      if (segment.c && code % CMD.DATA_B !== 0) {
        delete segment.c;
        segment.count--;
      }

      if (segment.p && code % CMD.DATA_RESEND_P !== 0) {
        delete segment.p;
        segment.count--;
      }

      if (this._resend[segment.id]) {
        continue;
      }
      if (now - segment.lastSack < this.connection.rto * 2) {
        continue;
      }
      if (segment.sack < CONFIRM - 1) {
        segment.lastSack = now;
        segment.sack++;
        continue;
      }
      this._resend[segment.id] = segment;
      segment.lastSent = now;
      segment.lastSack = now;
      segment.sack = 0;
      this.resentPacketCountConfirm++;
    }
  }

  /**
   * 当收到数据Packet
   * @param packet
   */
  receiveData(packet) {
    if (this.closed) {
      return;
    }
    this.lastAlive = Date.now();
    let segmentId = packet.segmentId;
    if (segmentId < this.confirmedMaxSegmentId) {
      //已经确认,重复接收
      return;
    }

    if (segmentId - this.confirmedMaxSegmentId > 10000) {
      //segmentId太大,不接受
      return;
    }

    let segment = this.received[segmentId];
    if (!segment) {
      segment = this.received[segmentId] = new Segment(segmentId, this, null);
    }

    let cmd = packet.cmd;
    if (!segment.a && cmd % CMD.DATA_A === 0) {
      //a
      segment.a = packet;
      segment.count++;
    } else if (!segment.b && cmd % CMD.DATA_B === 0) {
      //b
      segment.b = packet;
      segment.count++;
    } else if (!segment.c && cmd % CMD.DATA_C === 0) {
      //c
      segment.c = packet;
      segment.count++;
    } else if (!segment.p && cmd % CMD.DATA_P === 0) {
      //p
      segment.p = packet;
      segment.count++;
    } else {
      //没有能够识别包,或重复接收
      if (!segment.count) {
        delete this.received[segmentId];
      }
      return;
    }

    if (segmentId > this.receivedMaxSegmentId) {
      this.receivedMaxSegmentId = segmentId;
    }
    this.receivedLength = this.receivedMaxSegmentId - this.confirmedMaxSegmentId;

    if (segment.count >= 3) {
      setImmediate(() => this._readData());
    }
  }

  _readData() {
    if (this.closed) {
      return;
    }
    let i = this.confirmedMaxSegmentId;
    let buffers = [];
    while (true) {
      let segment = this.received[i + 1];
      if (!segment || segment.count < 3) {
        break;
      }
      try {
        let buffer = segment.unpack();
        buffers.push(buffer);
        i++;
        delete this.received[i];
      } catch (e) {
        break;
      }
    }
    if (!buffers.length) {
      return;
    }
    this.confirmedMaxSegmentId = i;
    this.receivedLength = this.receivedMaxSegmentId - this.confirmedMaxSegmentId;
    let data;
    if (buffers.length === 1) {
      data = buffers[0];
    } else {
      data = Buffer.concat(buffers);
    }
    this.bytesRead += data.length;
    setImmediate(() => {
      this.emit('data', data);
    });
    if (!this.confirmTimer) {
      this.confirmTimer = setTimeout(() => {
        //发送确认包
        this.confirmTimer = 0;
        this._confirm();
      }, 2);
    }
  }

  _confirm() {
    //发送确认包
    let buffer = new Buffer(8);
    buffer.writeUInt8(CMD.CONFIRM, 0);
    this.idBuffer.copy(buffer, 1);
    buffer.writeUInt32LE(this.confirmedMaxSegmentId, 4);

    let buffers = [buffer];
    if (this.receivedMaxSegmentId > this.confirmedMaxSegmentId) {
      //有空白
      for (let offset = 1; offset < 200 && this.confirmedMaxSegmentId + offset <= this.receivedMaxSegmentId; offset++) {
        let i = this.confirmedMaxSegmentId + offset;
        let segment = this.received[i];
        if (segment && segment.count >= 3) {
          continue;
        }
        let sack = new Buffer(2);
        sack.writeUInt8(offset);
        let code = 1;
        if (!segment) {
          code = CMD.DATA_RESEND_ALL;
        } else {
          if (!segment.a) {
            code *= CMD.DATA_A;
          }
          if (!segment.b) {
            code *= CMD.DATA_B;
          }
          if (!segment.c) {
            code *= CMD.DATA_C;
          }
          if (!segment.p) {
            code *= CMD.DATA_RESEND_P;
          }
        }
        sack.writeUInt8(code, 1);
        buffers.push(sack);
      }
    }

    if (buffers.length > 1) {
      buffer = Buffer.concat(buffers);
    }
    let packet = new Packet(buffer);
    this.connection.send(packet);
  }
}

Stream.maxId = 16777216;

module.exports = Stream;
