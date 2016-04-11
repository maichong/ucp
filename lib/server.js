/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');
const Connection = require('./connection');
const Bus = require('./bus');
const CMD = require('./cmd');

class Server extends EventEmitter {
  constructor(options, connectionListener) {
    super();
    this._connectionListener = connectionListener;
    this.options = options || {};
    this.listening = false;
    this._connections = {};
    this._connectionsCount = 0;
  }

  listen(options) {
    Object.assign(this.options, options);
    if (!this.options.port) {
      throw new Error('port is required');
    }
    if (!this.options.password) {
      throw new Error('password is required');
    }

    this.socket = dgram.createSocket('udp4');

    this.socket.bind(this.options.port, () => {
      this.listening = true;
      this.emit('listening');
      console.log('listening...');
    });

    this.socket.on('error', (err) => {
      console.error(`server error:\n${err.stack}`);
      if (!this.listening) {
        this.socket.close();
      }
    });

    this.socket.on('message', (msg, rinfo) => {
      //console.log('on message', msg);
      //AES
      let packets = Bus.parse(msg);
      if (!packets.length) {
        return;
      }
      let addr = rinfo.address + ':' + rinfo.port;
      let connection = this._connections[addr];
      if (!connection) {
        connection = this._connections[addr] = new Connection(rinfo, this._connectionListener);
        connection.incoming = true;
        connection.socket = this.socket;
        this._connectionsCount++;
        connection._pingTimer = setInterval(() => connection.ping(), 1000);
        connection.on('close', () => {
          //链接关闭
          delete this._connections[addr];
          this._connectionsCount--;
        });
      }
      connection.bytesRead += msg.length;
      packets.forEach(packet => connection.receive(packet));
    });
  }
}

module.exports = Server;
