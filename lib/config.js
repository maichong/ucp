/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-06-02
 * @author Liang <liang@maichong.it>
 */

'use strict';

module.exports = function config(name, defaultValue, type) {
  let value = defaultValue;
  if (process.env[name] !== undefined) {
    value = process.env[name];
  }

  switch (type) {
    case 'int':
      return parseInt(value) || 0;
  }
  return value;
};
