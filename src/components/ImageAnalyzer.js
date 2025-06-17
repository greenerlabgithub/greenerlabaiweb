import React, { useState } from 'react';
import axios from 'axios';

export default function ImageAnalyzer() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const toBase64 = file =>
    new Promise((res, rej) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.onerror = rej;
    });

  const analyze = async () => {
    if (!file) return alert('이미지를 선택하세요');
    setLoading(true);
    try {
      const b64 = await toBase64(file);
      const { data } = await axios.post('/api/analyze', { imageBase64: b64 });
      setResult(data);
    } catch (err) {
      console.error(err);
      alert('분석 중 오류 발생');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <input
        type="file"
        accept="image/*"
        onChange={e => setFile(e.target.files[0])}
      />
      <button
        onClick={analyze}
        disabled={loading}
        style={{ marginLeft: 10 }}
      >
        {loading ? '분석 중…' : '분석'}
      </button>

      {result && (
        <div style={{ marginTop: 20 }}>
          {/* 백엔드가 리턴하는 results 배열을 사용 */}
          {result.results.map((item, i) => (
            <div key={i} style={{ marginBottom: 24 }}>
              <h4>후보 #{i + 1}: {item.이름}</h4>
              <p><strong>정보:</strong> {item.정보}</p>
              <p><strong>방제방법:</strong></p>
              <ul>
                {item.방제방법.map((r, j) => (
                  <li key={j}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <p><strong>분석된 이미지:</strong></p>
            <img
              src={result.imageUrl}
              alt="분석된 결과"
              style={{ maxWidth: '100%', border: '1px solid #ccc' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
