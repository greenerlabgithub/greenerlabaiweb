import { useState } from 'react';
import axios from 'axios';

function App() {
  const [info, setInfo] = useState('');
  const [files, setFiles] = useState([]);
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);

  // File → Base64
  const toBase64 = (file) =>
    new Promise((res, rej) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.onerror = (err) => rej(err);
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { additionalInfo: info };
      for (let i = 0; i < files.length && i < 3; i++) {
        payload[`imageData${i + 1}`] = await toBase64(files[i]);
      }
      const { data } = await axios.post(
        '/api/analyze',
        payload
      );
      setResponse(data);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || '서버 오류');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>GreenerLabAI Chat</h1>
      <form onSubmit={handleSubmit}>
        <textarea
          rows={2}
          placeholder="추가 정보 입력"
          value={info}
          onChange={(e) => setInfo(e.target.value)}
        />
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) =>
            setFiles(Array.from(e.target.files).slice(0, 3))
          }
        />
        <button type="submit" disabled={loading}>
          {loading ? '분석 중…' : '전송'}
        </button>
      </form>

      {response && (
        <div style={{ marginTop: 20 }}>
          <h2>분석 결과</h2>
          <p>{response.result}</p>
          <div>
            {response.imageUrls.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                style={{ width: 150, marginRight: 10 }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
