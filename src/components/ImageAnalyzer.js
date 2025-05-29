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
    } catch {
      alert('분석 중 오류 발생');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        accept="image/*"
        onChange={e => setFile(e.target.files[0])}
      />
      <button onClick={analyze} disabled={loading} style={{ marginLeft: 10 }}>
        {loading ? '분석 중…' : '분석'}
      </button>

      {result && (
        <div>
          {result.predictions.map((item, i) => (
            <div key={i}>
              <h4>후보 #{i+1}: {item.pest}</h4>
              <p>원인:</p>
              <ul>
                {item.cause.map((c,j) => <li key={j}>{c}</li>)}
              </ul>
              <p>방제:</p>
              <ul>
                {item.remedy.map((r,j) => <li key={j}>{r}</li>)}
              </ul>
            </div>
          ))}
          <img src={result.imageUrl} alt="분석된 이미지" />
        </div>
      )}
    </div>
  );
}
