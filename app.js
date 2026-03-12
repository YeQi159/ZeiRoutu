const loginScreen = document.getElementById('loginScreen');
const mainScreen = document.getElementById('mainScreen');
const loginErr = document.getElementById('loginErr');

// UI Elements
const valTemp = document.getElementById('valTemp');
const valHumi = document.getElementById('valHumi');
const valGas = document.getElementById('valGas');
const valIR = document.getElementById('valIR');

const barTemp = document.getElementById('barTemp');
const barHumi = document.getElementById('barHumi');
const barGas = document.getElementById('barGas');
const barIR = document.getElementById('barIR');

const btnBuzzer = document.getElementById('btnBuzzer');
const btnServo = document.getElementById('btnServo');
const btnMotor = document.getElementById('btnMotor');

let isConnected = false;
let startTime = Date.now();
let updateCount = 0;
let connectionType = ''; // 'ble' or 'wifi'
let pollTimer = null;

// ==========================================
// BLE Variables
// ==========================================
let bluetoothDevice;
let customCharacteristicTX; // To receive from ESP
let customCharacteristicRX; // To send to ESP
const SERVICE_UUID = 0xFFE0;
const CHAR_RX_UUID = 0xFFE1;
const CHAR_TX_UUID = 0xFFE2;

// ==========================================
// Connection Handlers
// ==========================================
document.getElementById('loginBtnBle').addEventListener('click', async () => {
    try {
        loginErr.style.opacity = 0;

        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: "Kitchen_Assistant" }],
            optionalServices: [SERVICE_UUID]
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        updateConnection(false, 'BLE 连接中...');

        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);

        // Receive Char
        customCharacteristicTX = await service.getCharacteristic(CHAR_TX_UUID);
        await customCharacteristicTX.startNotifications();
        customCharacteristicTX.addEventListener('characteristicvaluechanged', (e) => {
            const value = e.target.value;
            // 简单处理：将收到的字节数据传递给解析器
            parseDataBytes(value);
        });

        // Send Char
        customCharacteristicRX = await service.getCharacteristic(CHAR_RX_UUID);

        connectionType = 'ble';
        enterMainScreen('蓝牙 (BLE) 已连接');
    } catch (error) {
        showLoginError("蓝牙连接失败: " + error.message);
    }
});

document.getElementById('loginBtnWifi').addEventListener('click', () => {
    // Check if we can reach the local AP
    fetch('http://192.168.4.1/api/status', { method: 'GET', mode: 'no-cors' })
        .then(() => {
            connectionType = 'wifi';
            enterMainScreen('Wi-Fi 已连接');
            pollTimer = setInterval(pollWifiData, 2000);
        })
        .catch(e => {
            // Even if no-cors fails or network error, let's allow it for testing in real app
            // In a real WebView, you might just enforce the connection.
            connectionType = 'wifi';
            enterMainScreen('局域网 (Wi-Fi) 请求中');
            pollTimer = setInterval(pollWifiData, 2000);
        });
});

function enterMainScreen(statusMsg) {
    loginScreen.style.opacity = 0;
    setTimeout(() => {
        loginScreen.style.display = 'none';
        mainScreen.classList.remove('hidden');
        isConnected = true;
        updateConnection(true, statusMsg);
        setInterval(updateFooter, 1000);
    }, 400);
}

function showLoginError(msg) {
    loginErr.innerText = msg;
    loginErr.style.opacity = 1;
    loginScreen.querySelector('.apple-modal').classList.add('shake');
    setTimeout(() => {
        loginScreen.querySelector('.apple-modal').classList.remove('shake');
    }, 400);
}

function onDisconnected() {
    updateConnection(false, '连接已断开');
    isConnected = false;
    if (pollTimer) clearInterval(pollTimer);
}

// ==========================================
// Data Parsing & UI Update
// ==========================================
function parseDataBytes(dataView) {
    // 假设 STM32 发送的格式为: [0xAA, Temp, Humi, Gas, IR]
    if (dataView.byteLength >= 5 && dataView.getUint8(0) === 0xAA) {
        const temp = dataView.getUint8(1);
        const humi = dataView.getUint8(2);
        const gas = dataView.getUint8(3) * 10; // 假数据计算
        const ir = dataView.getUint8(4);

        updateUI(temp, humi, gas, ir);
    }
}

function updateUI(temp, humi, gas, ir) {
    updateCount++;
    document.getElementById('valCount').innerText = updateCount;

    valTemp.innerText = temp.toFixed(1);
    valHumi.innerText = humi.toFixed(1);
    valGas.innerText = gas;

    if (ir > 0) {
        valIR.innerText = "有人";
        valIR.style.color = "#dc2626";
        barIR.style.width = "100%";
        barIR.style.background = "#dc2626";
    } else {
        valIR.innerText = "无人";
        valIR.style.color = "#4f46e5";
        barIR.style.width = "0%";
    }

    barTemp.style.width = calcBar(temp, -10, 50) + '%';
    barHumi.style.width = calcBar(humi, 0, 100) + '%';
    barGas.style.width = calcBar(gas, 0, 1000) + '%';
}

function pollWifiData() {
    if (!isConnected || connectionType !== 'wifi') return;

    // 向 ESP32 的局域网 IP 发送请求 (需在 ESP32 上实现 HTTP 服务器)
    fetch('http://192.168.4.1/api/data')
        .then(r => r.json())
        .then(d => {
            updateConnection(true, 'Wi-Fi 接收中');
            updateUI(d.temp, d.humi, d.gas, d.ir);
        })
        .catch(e => {
            updateConnection(false, 'Wi-Fi 数据超时');
        });
}

// ==========================================
// Commands Sending
// ==========================================
async function sendCommand(cmdStr) {
    if (connectionType === 'ble' && customCharacteristicRX) {
        let encoder = new TextEncoder('utf-8');
        await customCharacteristicRX.writeValue(encoder.encode(cmdStr + '\n'));
        console.log("BLE Sent:", cmdStr);
    } else if (connectionType === 'wifi') {
        fetch('http://192.168.4.1/api/command', {
            method: 'POST',
            body: cmdStr
        }).then(() => console.log("WiFi Sent:", cmdStr)).catch(e => console.error(e));
    }
}

function handleToggleButton(btn, cmdPrefix) {
    let state = btn.getAttribute('data-state');
    if (state === "0") {
        btn.setAttribute('data-state', "1");
        btn.innerText = "开启中";
        sendCommand(cmdPrefix + ":1");
    } else {
        btn.setAttribute('data-state', "0");
        btn.innerText = "关闭";
        sendCommand(cmdPrefix + ":0");
    }
}

btnBuzzer.addEventListener('click', () => handleToggleButton(btnBuzzer, 'LED'));
btnServo.addEventListener('click', () => handleToggleButton(btnServo, 'SERVO'));
btnMotor.addEventListener('click', () => handleToggleButton(btnMotor, 'MOTOR'));

// ==========================================
// Utilities
// ==========================================
function updateConnection(online, msg) {
    const b = document.getElementById('statusBadge');
    const t = document.getElementById('statusText');
    if (online) {
        b.className = 'status-badge online';
        t.innerText = msg;
    } else {
        b.className = 'status-badge offline';
        t.innerText = msg;
    }
}

function calcBar(val, min, max) {
    let p = ((val - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, p));
}

function updateFooter() {
    let ms = Date.now() - startTime;
    let s = Math.floor(ms / 1000);
    let str = "";
    if (s < 60) str = s + "秒";
    else {
        let m = Math.floor(s / 60); s = s % 60;
        if (m < 60) str = m + "分 " + s + "秒";
        else {
            let h = Math.floor(m / 60); m = m % 60;
            str = h + "小时 " + m + "分";
        }
    }
    document.getElementById('valUptime').innerText = str;
}