let bluetoothDevice;
let customService;
let customCharacteristic;
let isNotifying = false;

// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusDiv = document.getElementById('status');
const deviceNameInput = document.getElementById('deviceName');
const serviceUuidInput = document.getElementById('serviceUuid');
const charUuidInput = document.getElementById('charUuid');
const readBtn = document.getElementById('readBtn');
const notifyBtn = document.getElementById('notifyBtn');
const receivedDataSpan = document.getElementById('receivedData');
const logArea = document.getElementById('logArea');
const sendBtn = document.getElementById('sendBtn');
const sendDataInput = document.getElementById('sendDataInput');

// Utility: Logging
function log(msg) {
    console.log(msg);
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    div.textContent = `[${time}] ${msg}`;
    logArea.appendChild(div);
    logArea.scrollTop = logArea.scrollHeight;
}

// Utility: parse UUID
function parseUUID(uuidStr) {
    uuidStr = uuidStr.trim().toLowerCase();
    if (/^[0-9a-f]{4}$/.test(uuidStr)) {
        return parseInt(uuidStr, 16);
    }
    return uuidStr;
}

// Connect to Device
connectBtn.addEventListener('click', async () => {
    try {
        if (!navigator.bluetooth) {
            log("Error: 当前浏览器不支持 Web Bluetooth API");
            return;
        }

        const devName = deviceNameInput.value.trim();
        const svcStr = serviceUuidInput.value.trim() || '180f'; // Default 180F Battery
        const svcUUID = parseUUID(svcStr);

        let options = {
            optionalServices: [svcUUID]
        };

        if (devName) {
            log(`请求蓝牙设备，名称过滤: ${devName}`);
            options.filters = [{ name: devName }];
        } else {
            log(`请求蓝牙设备，服务 UUID 过滤: ${svcUUID}`);
            options.filters = [{ services: [svcUUID] }];
        }

        // Request device
        bluetoothDevice = await navigator.bluetooth.requestDevice(options);

        log(`连接到设备: ${bluetoothDevice.name}`);
        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

        // Connect GATT server
        const server = await bluetoothDevice.gatt.connect();
        log('GATT 服务器连接成功');

        // Get Service
        customService = await server.getPrimaryService(svcUUID);
        log('获取到服务');

        // Get Characteristic
        const charStr = charUuidInput.value.trim() || '2a19'; // Default 2A19 Battery Level
        const charUUID = parseUUID(charStr);
        customCharacteristic = await customService.getCharacteristic(charUUID);
        log('获取到特征值');

        // Setup Notifications if supported
        if (customCharacteristic.properties.notify || customCharacteristic.properties.indicate) {
            customCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);
            log('特征值支持通知/指示，可以开启');
        }

        updateUI(true);
        log('设备准备就绪');
    } catch (error) {
        log(`连接错误: ${error}`);
        updateUI(false);
    }
});

// Disconnect
disconnectBtn.addEventListener('click', () => {
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
    }
});

function onDisconnected() {
    log('设备已断开连接');
    updateUI(false);
    isNotifying = false;
    notifyBtn.textContent = '开启通知';
}

// Update UI State
function updateUI(connected) {
    connectBtn.disabled = connected;
    disconnectBtn.disabled = !connected;
    serviceUuidInput.disabled = connected;
    charUuidInput.disabled = connected;
    readBtn.disabled = !connected;
    notifyBtn.disabled = !connected;
    sendBtn.disabled = !connected;

    statusDiv.textContent = connected ? '已连接' : '未连接';
    statusDiv.className = connected ? 'status-msg connected' : 'status-msg';
}

// Read Data
readBtn.addEventListener('click', async () => {
    if (!customCharacteristic) return;
    try {
        log('正在读取数据...');
        const value = await customCharacteristic.readValue();
        handleData(value);
    } catch (error) {
        log(`读取错误: ${error}`);
    }
});

// Toggle Notifications
notifyBtn.addEventListener('click', async () => {
    if (!customCharacteristic) return;
    try {
        if (!isNotifying) {
            log('开启通知...');
            await customCharacteristic.startNotifications();
            isNotifying = true;
            notifyBtn.textContent = '停止通知';
            log('通知已开启');
        } else {
            log('停止通知...');
            await customCharacteristic.stopNotifications();
            isNotifying = false;
            notifyBtn.textContent = '开启通知';
            log('通知已停止');
        }
    } catch (error) {
        log(`通知错误: ${error}`);
    }
});

// Handle incoming data
function handleNotifications(event) {
    const value = event.target.value;
    handleData(value);
}

function handleData(dataView) {
    // Process the dataview as Hex and String
    let hexString = [];
    let textStr = "";
    for (let i = 0; i < dataView.byteLength; i++) {
        const val = dataView.getUint8(i);
        hexString.push(val.toString(16).padStart(2, '0').toUpperCase());
        textStr += String.fromCharCode(val);
    }

    receivedDataSpan.textContent = `HEX: ${hexString.join(' ')} | 文本: ${textStr}`;
    log(`收到数据: ${hexString.join(' ')}`);
}

// Send Data
sendBtn.addEventListener('click', async () => {
    if (!customCharacteristic) return;

    const inputStr = sendDataInput.value.trim();
    if (!inputStr) {
        log('发送数据为空');
        return;
    }

    const dataType = document.querySelector('input[name="dataType"]:checked').value;
    let dataBuffer;

    if (dataType === 'string') {
        const encoder = new TextEncoder();
        dataBuffer = encoder.encode(inputStr);
    } else {
        // Hex String (e.g., "0A 1B 2C" or "0a1b2c")
        const hexStr = inputStr.replace(/[^0-9A-Fa-f]/g, '');
        if (hexStr.length % 2 !== 0) {
            log('十六进制数据长度无效');
            return;
        }
        dataBuffer = new Uint8Array(hexStr.length / 2);
        for (let i = 0; i < hexStr.length; i += 2) {
            dataBuffer[i / 2] = parseInt(hexStr.substring(i, i + 2), 16);
        }
    }

    try {
        log(`正在发送数据...`);
        if (customCharacteristic.properties.write) {
            await customCharacteristic.writeValue(dataBuffer);
        } else if (customCharacteristic.properties.writeWithoutResponse) {
            await customCharacteristic.writeValueWithoutResponse(dataBuffer);
        } else {
            log('该特征值不支持写入');
            return;
        }
        log(`发送成功`);
    } catch (error) {
        log(`发送失败: ${error}`);
    }
});