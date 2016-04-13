/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const bytes = require('bytes');

class Speed {

  constructor() {
    this.slices = {};
    this.start = Date.now();
    this.total = 0;
  }

  set(num) {
    this.add(num - this.total);
  }

  add(num) {
    let now = parseInt(Date.now() / 100) * 100;
    if (!this.slices[now]) {
      this.slices[now] = 0;
    }
    this.slices[now] += num;
    this.total += num;
  }

  current(unit) {
    let now = Date.now();
    let total = 0;
    for (let t in this.slices) {
      if ((t * 1 + 2000) < now) {
        delete this.slices[t];
        continue;
      }
      total += this.slices[t];
    }
    return unit === false ? total / 2 : bytes(total / 2);
  }

  all(unit) {
    let value = this.total / (Date.now() - this.start) * 1000;
    return unit === false ? value : bytes(value);
  }
}

module.exports = Speed;
