const { SerialPort } = require('serialport');

SerialPort.list().then(ports => {
  ports.forEach(function (port) {
    console.log(`${port.path} - ${port.pnpId || ''} ${port.manufacturer || ''}`);
  });
}).catch(err => {
  console.error('Error listing serial ports:', err);
});