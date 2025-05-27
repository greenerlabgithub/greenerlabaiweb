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
        <div style={{ marginTop: 20 }}>
          <h3>🎯 후보명</h3>
          <ul>
            {result.candidates.map((c,i) => (
              <li key={i}>{c.description} ({c.score.toFixed(2)})</li>
            ))}
          </ul>
          <h3>🔖 선택된 병해충</h3>
          <p>{result.label || '없음'}</p>
          <h3>⚠️ 피해 원인</h3>
          <p>{result.cause}</p>
          <h3>🛠️ 방제 방법</h3>
          <p>{result.remedy}</p>
          <h3>📷 업로드 이미지</h3>
          <img src={result.imageUrl} alt="" style={{ maxWidth: '100%' }} />
        </div>
      )}
    </div>
  );
}
