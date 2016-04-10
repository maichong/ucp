/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const CMD = require('./cmd');
const Packet = require('./packet');

function xor(a, b, c, p) {
  if (!p) {
    p = new Buffer(a.length);
  }
  for (let i = 8; i < a.length; i++) {
    p[i] = a[i] ^ b[i] ^ c[i];
  }
  return p;
}

class Segment {
  constructor(id, stream, buffer) {
    this.id = id;
    this.buffer = buffer;
    this.stream = stream;
    this.a = null;
    this.b = null;
    this.c = null;
    this.p = null;
    this.count = 0;
    //this.time = Date.now();
    this.ra = 0;
    this.rb = 0;
    this.rc = 0;
    //this.rp = 0;
  }

  pack() {
    //需要填充的个数
    let data = this.buffer;
    let padding = data.length % 3;
    let paddingCode = CMD.DATA_0;
    switch (padding) {
      case 1:
        padding = 2;
        paddingCode = CMD.DATA_2;
        break;
      case 2:
        padding = 1;
        paddingCode = CMD.DATA_1;
        break;
    }

    let packageLength = Math.ceil(data.length / 3);
    let a = new Buffer(packageLength + 8);
    let b = new Buffer(packageLength + 8);
    let c = new Buffer(packageLength + 8);
    let p = new Buffer(packageLength + 8);

    //写入控制符
    a.writeUInt8(CMD.DATA_A * paddingCode, 0);
    b.writeUInt8(CMD.DATA_B * paddingCode, 0);
    c.writeUInt8(CMD.DATA_C * paddingCode, 0);
    p.writeUInt8(CMD.DATA_P * paddingCode, 0);

    //写入stream id和segment id
    let streamIdBuffer = this.stream.idBuffer;
    [a, b, c, p].forEach(p => {
      //Stream ID
      streamIdBuffer.copy(p, 1);

      //Segment ID
      p.writeUInt32LE(this.id, 4);
    });

    data.copy(a, 8, 0, packageLength);
    data.copy(b, 8, packageLength, packageLength * 2);
    data.copy(c, 8, packageLength * 2, packageLength * 3 - padding);

    //计算校验包
    p = xor(a, b, c, p);

    this.a = new Packet(a, this);
    this.b = new Packet(b, this);
    this.c = new Packet(c, this);
    this.p = new Packet(p, this);
    this.b.delay = 2;
    this.c.delay = 6;
    this.p.delay = 10;
    this.count = 4;
  }

  unpack() {
    let a;
    let b;
    let c;
    let p;
    if (this.a) {
      a = this.a.buffer;
    }
    if (this.b) {
      b = this.b.buffer;
    }
    if (this.c) {
      c = this.c.buffer;
    }
    if (this.p) {
      p = this.p.buffer;
    }

    let padding = 0;

    if (!a) {
      a = xor(b, c, p);
      padding = b.readUInt8(0) / CMD.DATA_B;
    } else {
      padding = a.readUInt8(0) / CMD.DATA_A;
    }
    if (!b) {
      b = xor(a, c, p);
    }
    if (!c) {
      c = xor(a, b, p);
    }
    switch (padding) {
      case CMD.DATA_0:
        padding = 0;
        break;
      case CMD.DATA_1:
        padding = 1;
        break;
      case CMD.DATA_2:
        padding = 2;
        break;
      default:
        throw new Error('invaild padding code');
    }

    //包内数据长度
    let packageLength = a.length - 8;

    let data = new Buffer(packageLength * 3 - padding);

    a.copy(data, 0, 8);
    b.copy(data, packageLength, 8);
    c.copy(data, packageLength * 2, 8, c.length - padding);
    this.buffer = data;
    return data;
  }
}

module.exports = Segment;
