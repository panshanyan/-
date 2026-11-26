const PANELS = [
  { id: 'r', name: 'Roll', on: 1, ser: L => [['setpoint[0]', '指令', 'ink'], ['gyroADC[0]', '陀螺', C[0]]], unit: '°/s' },
  { id: 'p', name: 'Pitch', on: 1, ser: L => [['setpoint[1]', '指令', 'ink'], ['gyroADC[1]', '陀螺', C[0]]], unit: '°/s' },
  { id: 'y', name: 'Yaw', on: 0, ser: L => [['setpoint[2]', '指令', 'ink'], ['gyroADC[2]', '陀螺', C[0]]], unit: '°/s' },
  { id: 'm', name: '馬達輸出', on: 1, ser: L => [0, 1, 2, 3, 4, 5, 6, 7].filter(k => L.F[`motor[${k}]`]).map(k => [`motor[${k}]`, 'M' + (k + 1), C[k + 1]]).concat([['rcCommand[3]', '油門', 'ink', v => (v - 1000) * 2.047]]) },
  { id: 'e', name: '馬達轉速', on: 0, ser: L => [0, 1, 2, 3, 4, 5, 6, 7].filter(k => L.F[`eRPM[${k}]`]).map(k => [`eRPM[${k}]`, 'M' + (k + 1), C[k + 1], v => v * 100]), unit: 'eRPM' },
  { id: 'v', name: '電壓', on: 1, ser: L => [['vbatLatest', '電壓 V', C[1], v => v / 100]], unit: 'V' },
  { id: 'a', name: '電流', on: 0, ser: L => [['amperageLatest', '電流 A', C[6], v => v / 100]], unit: 'A' },
  { id: 'pr', name: 'Roll PID', on: 0, ser: L => [['axisP[0]', 'P', C[1]], ['axisI[0]', 'I', C[3]], ['axisD[0]', 'D', C[2]], ['axisF[0]', 'F', C[6]]] },
  { id: 'pp', name: 'Pitch PID', on: 0, ser: L => [['axisP[1]', 'P', C[1]], ['axisI[1]', 'I', C[3]], ['axisD[1]', 'D', C[2]], ['axisF[1]', 'F', C[6]]] },
  { id: 'g', name: '加速度', on: 0, ser: L => [0, 1, 2].map(k => [`accSmooth[${k}]`, 'XYZ'[k], C[k + 1], v => v / Number(L.hdr.acc_1G || 2048)]), unit: 'g' },
];
try { const s = JSON.parse(localStorage.getItem('bbPanels') || 'null'); if (s) PANELS.forEach(p => p.on = s.includes(p.id) ? 1 : 0); } catch (e) {}

