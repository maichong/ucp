/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

let Stream;

class Packet {
  constructor(cmd, segment, size) {
    if (cmd instanceof Buffer) {
      this.buffer = cmd;
    } else {
      if (cmd || size) {
        this.buffer = new Buffer(size || 1);
      }
      if (cmd) {
        this.buffer.writeUInt8(cmd, 0);
      }
    }
    if (segment) {
      if (cmd instanceof Buffer) {
        this.segment = segment;
      } else {
        this.setSegment(segment);
      }
    }
    this.delay = 0;
  }

  get cmd() {
    if (!this._cmd) {
      this._cmd = this.buffer.readUInt8(0);
    }
    return this._cmd;
  }

  setSegment(segment) {
    this.segment = segment;
    segment.stream.idBuffer.copy(this.buffer, 1);
    this.buffer.writeUInt32LE(segment.id, 4);
  }

  get streamId() {
    let tmp = new Buffer(3);
    this.buffer.copy(tmp, 0, 1, 4);
    if (!Stream) {
      Stream = require('./stream');
    }
    return Stream.bufferToId(tmp);
  }

  get segmentId() {
    return this.buffer.readUInt32LE(4);
  }
}

module.exports = Packet;

