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
const config = require('./config');

const UCP_STREAM_NEED_COMFIRM = config('UCP_STREAM_NEED_COMFIRM', 4, 'int');
const UCP_STREAM_TIMEOUT = config('UCP_STREAM_TIMEOUT', 20000, 'int');
const UCP_STREAM_TIMEOUT_TIMER = config('UCP_STREAM_TIMEOUT_TIMER', 5000, 'int');
const UCP_STREAM_CONFIRM_TIMER = config('UCP_STREAM_CONFIRM_TIMER', 5, 'int');
const UCP_STREAM_AUTO_RESEND_TIMER = config('UCP_STREAM_AUTO_RESEND_TIMER', 20, 'int');
const UCP_STREAM_RESEND_RTO_RATE = config('UCP_STREAM_RESEND_RTO_RATE', 2, 'int');
const UCP_STREAM_RESEND_PRE = config('UCP_STREAM_RESEND_PRE', 20, 'int');
const UCP_STREAM_WRITE_MAX = config('UCP_STREAM_WRITE_MAX', 4320, 'int');
const UCP_STREAM_CONFIRM_MISSING_COUNT = config('UCP_STREAM_CONFIRM_MISSING_COUNT', 250, 'int');
const UCP_STREAM_WRITE_FAST = config('UCP_STREAM_WRITE_FAST', 20, 'int');
const UCP_STREAM_WRITE_QUICK = config('UCP_STREAM_WRITE_QUICK', 300, 'int');
const UCP_STREAM_WRITE_NORMAL = config('UCP_STREAM_WRITE_NORMAL', 600, 'int');
const UCP_STREAM_WRITE_SLOW = config('UCP_STREAM_WRITE_SLOW', 1000, 'int');
const UCP_STREAM_RTO_MIN = config('UCP_STREAM_RTO_MIN', 80, 'int');
const UCP_STREAM_RTO_MAX = config('UCP_STREAM_RTO_MAX', 800, 'int');

//let log = console.log;
//console.log = function () {
//  let args = Array.prototype.slice.call(arguments);
//  args.unshift(Date.now() / 1000);
//  return log.apply(console, args);
//};

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
    this.lastAlive = Date.now();
    this.sent = {};//发送端,已经发送,待确认的Segment
    this.sentLength = 0; //已经发送,待确认的Segment数量
    this.bytesRead = 0;
    this.bytesWritten = 0;
    this.remoteAddress = connection.remoteAddress;
    this.remotePort = connection.remotePort;
    this._writeQueue = [];
    this._writeTimer = 0;
    this.resentPacketCount = 0;
    this.resentPacketCountAuto = 0;
    this.resentPacketCountConfirm = 0;
    this.resentPacketCountLast = 0;
    this.resentPacketSpeed = 0;
    this._resend = {}; //重新发送列表
    this.srtt = 100;
    this.rto = 100;
    this.state = Stream.CONNECTED;

    this._resendQueueTimer = 0;

    this._debugTimer = setInterval(()=> {
      this.resentPacketSpeed = (this.resentPacketCount - this.resentPacketCountLast) * 5;
      this.resentPacketCountLast = this.resentPacketCount;
      //console.log('write queue:', this._writeQueue.length, 'sent:', this.sentLength, 'receive queue:', this.receivedLength,
      //  'confirmed', this.confirmedMaxSegmentId,
      //  'srtt:', parseInt(this.srtt),
      //  'rto:', parseInt(this.rto),
      //  'resend:', Object.keys(this._resend || {}).length, 'resent packets:', this.resentPacketSpeed, this.resentPacketCount);
    }, 200);

    //存活检查
    this._aliveTimer = setInterval(() => {
      if (Date.now() - this.lastAlive > UCP_STREAM_TIMEOUT) {
        this.destroy();
      }
    }, UCP_STREAM_TIMEOUT_TIMER);

    //确认Timer
    this._confirmTimer = setInterval(() => this._confirm(), UCP_STREAM_CONFIRM_TIMER);

    //自动重发
    this._autoResendTimer = setInterval(() => {
      let now = Date.now();
      for (let i in this.sent) {
        let segment = this.sent[i];
        if (!this._resend[segment.id] && now - segment.lastSent > this.rto * UCP_STREAM_RESEND_RTO_RATE) {
          segment.lastSent = now;
          segment.sack = 0;
          this._resend[segment.id] = segment;
          this.resentPacketCountAuto++;
        }
      }
      this._resendQueue();
    }, UCP_STREAM_AUTO_RESEND_TIMER);
  }

  _resendQueue() {
    if (this._resendQueueTimer) {
      return;
    }
    if (!this.writable) {
      this._resend = {};
      return;
    }
    this._resendQueueTimer = setTimeout(() => {
      this._resendQueueTimer = 0;
      let now = Date.now();
      let count = 0;
      for (let id in this._resend) {
        count++;
        if (count > UCP_STREAM_RESEND_PRE) return;
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
    }, 10);
  }

  destroy() {
    //console.log('stream.destroy');
    if (this.state === Stream.CLOSED) return;
    this.closeRead();
    this.closeWrite();
    this._destroy();
  }

  _destroy() {
    this.state = Stream.CLOSED;
    clearInterval(this._aliveTimer);
    clearInterval(this._debugTimer);
    delete this._idBuffer;
    delete this.connection;
    this.emit('close');
  }

  closeRead() {
    //console.log('closeRead');
    if (this.receivedLength) {
      console.error('this.receivedLength:' + this.receivedLength);
      console.trace();
    }
    if (this.state === Stream.CONNECTED) {
      this.state = Stream.WAIT_SEND;
    } else if (this.state === Stream.WAIT_RECEIVE) {
    } else {
      return;
    }
    this._confirm();
    clearInterval(this._confirmTimer);
    delete this.received;
    this.receivedLength = 0;
    if (!this._writeQueue.length) {
      this._sendClose();
    } else {
      //console.log('-------稍后send close--------');
      this._write();
    }

    if (this.state === Stream.WAIT_RECEIVE) {
      this._destroy();
    } else if (!this.sentLength && !this._writeQueue.length) {
      //没有输出队列
      setTimeout(() => this.destroy(), 2);
    }
  }

  _sendClose() {
    let buffer = new Buffer(8);
    buffer.writeUInt8(CMD.CLOSE_STREAM);
    this.idBuffer.copy(buffer, 1);
    buffer.writeUInt32LE(this.sentMaxSegmentId, 4);
    let packet = new Packet(buffer);
    //console.log('send close');
    //console.log('sent:', this.sentMaxSegmentId, this._writeQueue.length, 'recv', this.receivedMaxSegmentId, this.confirmedMaxSegmentId, this.receivedLength);
    //console.trace();
    this.connection.send(packet);
  }

  closeWrite() {
    //console.log('closeWrite');
    //if (this.sentLength) {
    //  console.error('stream.sentLength : ' + this.sentLength);
    //  console.trace();
    //  //console.log(this.sent);
    //}
    if (this.state === Stream.CONNECTED) {
      this.state = Stream.WAIT_RECEIVE;
    } else if (this.state === Stream.WAIT_SEND) {
    } else {
      return;
    }
    clearInterval(this._autoResendTimer);
    this._writeQueue = [];
    delete this.sent;
    delete this._resend;
    this.sentLength = 0;

    if (this.state === Stream.WAIT_SEND) {
      this._destroy();
    } else if (!this.receivedLength) {
      //没有输入队列
      setTimeout(() => this.destroy(), 2);
    }
    //console.log('closeWrite end');
  }

  get readable() {
    return this.state % Stream.READABLE === 0;
  }

  get writable() {
    return this.state % Stream.WRITABLE === 0;
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
   */
  write(data, encoding) {
    //console.log('stream.write');
    if (!this.writable) return;
    if (!data || !data.length) {
      return;
    }
    if (typeof data === 'string') {
      data = new Buffer(data, encoding);
    }

    //如果一次写入的数据大于单个包最大数据
    //拆开写入多次
    if (data.length > UCP_STREAM_WRITE_MAX) {
      for (let start = 0; start < data.length; start += UCP_STREAM_WRITE_MAX) {
        let end = start + UCP_STREAM_WRITE_MAX;
        if (end > data.length) {
          end = data.length;
        }
        this._writeQueue.push(data.slice(start, end));
      }
    } else {
      this._writeQueue.push(data);
    }
    if (!this._writeTimer) {
      this._write();
    }
  }

  _write() {
    //console.log('stream._write');
    this._writeTimer = 0;
    //if (this.state === Stream.WAIT_SEND) {
    //  console.log(this._writeQueue.length, this.sentLength, this.connection.rto);
    //}
    if (!this.writable) return;
    if (!this._writeQueue.length) {
      if (this.state === Stream.WAIT_SEND) {
        //send close
        this._sendClose();
      }
      return;
    }
    //let rto = this.connection.rto;
    //if (this.sentLength > rto * 5) {
    //  this._writeTimer = setTimeout(() => this._write(), 2);
    //  return;
    //}
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
    //if (this.rto > 500) {
    this.connection._send(segment.p);
    //}
    this.sent[segment.id] = segment;
    this.sentLength++;
    if (!this._writeQueue.length) return;
    if (this.sentLength < UCP_STREAM_WRITE_FAST && this.resentPacketSpeed < UCP_STREAM_WRITE_FAST) {
      this._writeTimer = 1;
      this._write();
    } else if (this.sentLength < UCP_STREAM_WRITE_QUICK && this.resentPacketSpeed < UCP_STREAM_WRITE_QUICK) {
      this._writeTimer = setImmediate(() => this._write());
    } else if (this.sentLength < UCP_STREAM_WRITE_NORMAL && this.resentPacketSpeed < UCP_STREAM_WRITE_NORMAL) {
      this._writeTimer = setTimeout(() => this._write(), 2);
    } else if (this.sentLength < UCP_STREAM_WRITE_SLOW && this.resentPacketSpeed < UCP_STREAM_WRITE_SLOW) {
      this._writeTimer = setTimeout(() => this._write(), 20);
    } else {
      this._writeTimer = setTimeout(() => this._write(), 50);
    }
  }

  //flush() {
  //  console.log('stream.flush', this._writeQueue.length);
  //  if (this.state === Stream.CLOSED) return;
  //  while (this._writeQueue.length) {
  //    let data = this._writeQueue.shift();
  //    console.log('flush', data.length);
  //    if (!data) {
  //      return;
  //    }
  //    this.bytesWritten += data.length;
  //    this.sentMaxSegmentId++;
  //    let segment = new Segment(this.sentMaxSegmentId, this, data);
  //    segment.pack();
  //    segment.lastSent = Date.now();
  //    this.connection.send(segment.a);
  //    this.connection.send(segment.b);
  //    this.connection.send(segment.c);
  //    this.connection.send(segment.p);
  //    this.sent[segment.id] = segment;
  //    this.sentLength++;
  //  }
  //}

  /**
   * 当收到Packet
   * @param packet
   */
  receive(packet) {
    this.lastAlive = Date.now();

    if (packet.cmd === CMD.CONFIRM) {
      //console.log('got confirm');
      this._receiveSACK(packet);
    } else if (packet.cmd === CMD.CLOSE_STREAM) {
      this.receivedMaxSegmentId = packet.buffer.readUInt32LE(4);
      this.receivedLength = this.receivedMaxSegmentId - this.confirmedMaxSegmentId;
      //console.log('got close cmd');
      //console.log('sent:', this.sentMaxSegmentId, this._writeQueue.length, 'recv', this.receivedMaxSegmentId, this.confirmedMaxSegmentId, this.receivedLength);
      this.closeWrite();
    }
  }

  _receiveSACK(packet) {
    //if (this.state === Stream.WAIT_SEND) {
    //  console.log('receive sack');
    //}
    if (!this.writable) return;
    const now = Date.now();
    let segmentId = packet.segmentId;
    for (let i = this.successMaxSegmentId + 1; i <= packet.segmentId; i++) {
      if (this.sent[i]) {
        let time = now - this.sent[i].createdAt;
        this.srtt = 0.98 * this.srtt + 0.02 * time;
        this.rto = Math.min(UCP_STREAM_RTO_MAX, Math.max(UCP_STREAM_RTO_MIN, this.srtt));
        this.sentLength--;
        delete this.sent[i];
        //console.log('receive.remove', i);
      }
      delete this._resend[i];
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
        this.destroy();
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
      if (now - segment.lastSack < this.rto * 2) {
        continue;
      }
      if (segment.sack < UCP_STREAM_NEED_COMFIRM) {
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
    if (!this.sentLength && !this._writeQueue.length && !this.readable) {
      this.destroy();
    } else {
      this._resendQueue();
    }
  }

  /**
   * 当收到数据Packet
   * @param packet
   */
  receiveData(packet) {
    if (!this.readable) return;
    this.lastAlive = Date.now();
    let segmentId = packet.segmentId;
    if (segmentId < this.confirmedMaxSegmentId) {
      //已经确认,重复接收
      return;
    }

    if (segmentId - this.confirmedMaxSegmentId > 20000) {
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
    if (!this.readable) return;
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
      if (!this.receivedLength && !this.writable) {
        //console.log('已接收完毕', this.receivedMaxSegmentId, this.confirmedMaxSegmentId, this.receivedLength);
        this._confirm();
        setTimeout(() => this.destroy(), 5);
      }
    });
  }

  _confirm() {
    //发送确认包
    if (!this.receivedLength || !this.readable) return;
    //console.log('confirm');
    let buffer = new Buffer(8);
    buffer.writeUInt8(CMD.CONFIRM, 0);
    this.idBuffer.copy(buffer, 1);
    buffer.writeUInt32LE(this.confirmedMaxSegmentId, 4);

    let buffers = [buffer];
    if (this.receivedMaxSegmentId > this.confirmedMaxSegmentId) {
      //有空白
      for (let offset = 1; offset < UCP_STREAM_CONFIRM_MISSING_COUNT && this.confirmedMaxSegmentId + offset <= this.receivedMaxSegmentId; offset++) {
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
    //console.log('send confirm');
    this.connection._send(packet);
  }
}

Stream.maxId = 16777216;
Stream.CONNECTING = 1;
Stream.CONNECTED = 6;
Stream.WAIT_SEND = 2;//只写
Stream.WAIT_RECEIVE = 3;//只读
Stream.CLOSED = 5;
Stream.FAILED = 7;
Stream.WRITABLE = 2;
Stream.READABLE = 3;

module.exports = Stream;
