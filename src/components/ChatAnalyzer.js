// src/components/ChatAnalyzer.js
import React, { useState } from 'react';
import axios from 'axios';

export default function ChatAnalyzer() {
  const [files, setFiles] = useState([]);
  const [info, setInfo]   = useState('');
  const [chat, setChat]   = useState([]);  // { sender, text, images: [url,…] }

  // 파일 선택
  const onFileChange = e => {
    setFiles(Array.from(e.target.files));
  };

  // “보내기” 버튼
  const onSend = async () => {
    if (!files.length && !info) return;
    // 1) 사용자 메시지 추가
    setChat(c => [...c, { sender:'user', text:info, images: files.map(f=>URL.createObjectURL(f)) }]);
    // 2) base64 변환
    const toB64 = file => new Promise((res, rej) => {
      const r = new FileReader();
      r.readAsDataURL(file);
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
    });
    const b64s = await Promise.all(files.map(toB64));
    // 3) payload 구성
    const payload = { additionalInfo: info };
    b64s.forEach((b64, i) => payload[`imageData${i+1}`] = b64);
    // 4) API 호출
    try {
      const { data } = await axios.post('/api/analyze', payload);
      // 5) 봇 메시지 추가
      setChat(c => [...c, {
        sender:'bot',
        text: data.result,
        images: data.imageUrls || []
      }]);
    } catch (e) {
      console.error(e);
      setChat(c => [...c, { sender:'bot', text:'⚠️ 오류가 발생했습니다.' }]);
    }
    // 초기화
    setFiles([]);
    setInfo('');
  };

  return (
    <div style={{ maxWidth: 600, margin: 'auto' }}>
      <div style={{
        border: '1px solid #ccc', padding: 10, height: 400,
        overflowY: 'auto', marginBottom: 10, borderRadius: 4
      }}>
        {chat.map((m,i) => (
          <div key={i} style={{
            textAlign: m.sender==='user' ? 'right' : 'left',
            margin: '8px 0'
          }}>
            <div style={{
              display: 'inline-block',
              background: m.sender==='user' ? '#acf' : '#eee',
              padding: 8, borderRadius: 4, maxWidth: '80%'
            }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              {m.images.map((url,j) => (
                <img key={j} src={url} alt="" style={{ width: 80, margin: 4, borderRadius: 4 }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 10 }}>
        <input type="file" multiple accept="image/*" onChange={onFileChange} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder="추가 정보 입력"
          value={info}
          onChange={e=>setInfo(e.target.value)}
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
      </div>
      <button onClick={onSend} style={{ width: '100%', padding: 10 }}>
        보내기
      </button>
    </div>
  );
}

