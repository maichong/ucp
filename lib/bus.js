/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const Packet = require('./packet');
const CMD = require('./cmd');

class Bus {
  constructor(packet) {
    this.departure = Date.now() + 10;
    this.packets = [];
    this.length = 0;
    if (packet) {
      this.packets.push(packet);
      this.length += packet.buffer.length;
      packet.onBus = true;
    }
  }

  /**
   * 将一个buffer数据解析为多个Packet
   * @param buffer
   * @returns {[Packet]}
   */
  static parse(buffer) {
    let cmd = buffer.readUInt8(0);
    if (cmd !== CMD.MULTIPLEX) {
      return [new Packet(buffer)];
    }
    let i = 1;
    const packets = [];
    while (i < buffer.length) {
      let length = buffer.readUInt16LE(i);
      if (i + length > buffer.length) {
        //解析失败
        return [];
      }
      i += 2;
      let packet = new Packet(buffer.slice(i, i + length));
      packets.push(packet);
      i += length;
    }
    return packets;
  }

  ride(packet) {
    if (packet.buffer.length + this.length >= 1460) {
      //如果过长,不允许搭车
      return false;
    }

    if (packet.segment) {
      if (this.packets.find(p => p.segment === packet.segment)) {
        //如果找到了来自同一个segment,则不允许搭车
        return false;
      }
    }

    //允许搭车
    this.packets.push(packet);
    this.length += packet.buffer.length;
    packet.onBus = true;

    return true;
  }

  getData() {
    if (this.packets.length === 1) {
      this.packets[0].onBus = false;
      return this.packets[0];
    }

    let packet = new Packet(CMD.MULTIPLEX, null, this.length + 1 + this.packets.length * 2);
    let i = 1;
    this.packets.forEach(p => {
      packet.buffer.writeUInt16LE(p.buffer.length, i);
      i += 2;
      p.buffer.copy(packet.buffer, i);
      i += p.buffer.length;
      p.onBus = false;
    });
    return packet;
  }
}

module.exports = Bus;
