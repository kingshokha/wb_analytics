'use strict';
// --- Zip для файлов xlsx: чтение (оптовые цены Lenardi) и запись (шаблоны WB для загрузки в кабинет).
// Пакетов у сайта нет: xlsx — обычный zip без ZIP64, сжатие и контрольная сумма — встроенный zlib.
const zlib = require('node:zlib');

// Файлы zip: имя → содержимое.
function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('это не файл xlsx');
  const files = new Map();
  for (let index = 0, at = buffer.readUInt32LE(end + 16), count = buffer.readUInt16LE(end + 10); index < count; index++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('файл xlsx повреждён');
    const method = buffer.readUInt16LE(at + 10),
      size = buffer.readUInt32LE(at + 20),
      nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42),
      name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28),
      data = buffer.subarray(start, start + size);
    if (method === 0 || method === 8) files.set(name, method ? zlib.inflateRawSync(data) : data);
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}

// Время файлов в zip — в формате MS-DOS (местное время, секунды с шагом 2).
function dosTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

// files — [[имя, Buffer | строка], …] в нужном порядке (у xlsx первым идёт [Content_Types].xml).
function zip(files, date = new Date()) {
  const { time, date: day } = dosTime(date);
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const packed = zlib.deflateRawSync(data),
      nameBytes = Buffer.from(name, 'utf8'),
      crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // имена в UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

module.exports = { unzip, zip };
