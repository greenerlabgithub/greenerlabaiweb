import React, { useState } from 'react';
import axios from 'axios';

export default function ImageAnalyzer() {
  const [files, setFiles] = useState([]);
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // 파일 선택 처리
  const handleFileChange = (e) => {
    const chosen = Array.from(e.target.files).slice(0, 3);
    setFiles(chosen);
  };

  // Base64로 변환
  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!files.length) {
      alert('최소 1개의 이미지를 선택해주세요');
      return;
    }
    setLoading(true);
    try {
      // 이미지 base64 준비
      const payload = {};
      for (let i = 0; i < files.length; i++) {
        payload[`imageData${i+1}`] = await toBase64(files[i]);
      }
      payload.additionalInfo = additionalInfo;

      const { data } = await axios.post('/api/analyze', payload);
      setResult(data.result);
    } catch (err) {
      console.error(err);
      alert('분석 중 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h2 className="text-xl font-bold mb-4">이미지 분석</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-1">이미지 선택 (최대 3개)</label>
          <input type="file" accept="image/*" multiple onChange={handleFileChange} />
        </div>
        <div>
          <label className="block mb-1">추가 정보</label>
          <input
            type="text"
            value={additionalInfo}
            onChange={e => setAdditionalInfo(e.target.value)}
            className="w-full border p-2"
            placeholder="촬영된 부위 및 증상 설명"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-green-600 text-white px-4 py-2 rounded"
        >
          {loading ? '분석 중...' : '분석 요청'}
        </button>
      </form>

      {result && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold">분석 결과</h3>
          <pre className="whitespace-pre-wrap bg-gray-100 p-3 rounded">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}

