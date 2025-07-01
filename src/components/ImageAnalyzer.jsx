// src/components/ImageAnalyzer.jsx
import React, { useState, useRef } from 'react';
import axios from 'axios';
import './ImageAnalyzer.css';
import TreeAiDLogo from './pubilc/TreeAiD.png';
import ImageIcon from './pubilc/Image.png';
import CamIcon from './pubilc/Cam.png';

export default function DiagnosePage() {
  const [status, setStatus] = useState('idle');       // 'idle' | 'analyzing' | 'done'
  const [result, setResult] = useState(null);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  // 파일을 Base64로 변환
  const toBase64 = file =>
    new Promise((res, rej) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.onerror = rej;
    });

  // AI 분석 호출
  const analyzeImage = async (base64) => {
    setStatus('analyzing');
    try {
      const { data } = await axios.post('/api/analyze', { imageBase64: base64 });
      setResult(data);
      setStatus('done');
    } catch (e) {
      console.error(e);
      alert('분석 중 오류 발생');
      setStatus('idle');
    }
  };

  // 파일 선택 처리 (카메라/갤러리 공통)
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const b64 = await toBase64(file);
    analyzeImage(b64);
  };

  // 카메라 및 갤러리 열기
  const openCamera = () => cameraRef.current?.click();
  const openGallery = () => galleryRef.current?.click();

  // 좌측 패널 콘텐츠 결정
  let leftPanel;
  if (status === 'idle') {
    leftPanel = (
      <>
        <div className="upload-area" onClick={openGallery}>
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <img src={ImageIcon} alt="Upload" />
          <p className="upload-text">
            이곳을 클릭해 파일을 업로드하거나,<br />
            파일을 드래그로 가져와서 올려주세요.
          </p>
          <p className="upload-note">
            업로드 가능한 최대 파일 사이즈 : 1GB
          </p>
        </div>
        <button className="camera-btn" onClick={openCamera}>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <img src={CamIcon} alt="Camera" />
          <span>카메라 앱으로 찍기</span>
        </button>
      </>
    );
  } else if (status === 'analyzing') {
    leftPanel = (
      <div className="preview-area">
        <div className="spinner" />
        <p>GreenerLab의 AI가 올려주신 이미지를 분석중입니다.</p>
      </div>
    );
  } else {
    leftPanel = (
      <div className="preview-area">
        <img className="preview-image" src={result.imageUrl} alt="Uploaded" />
      </div>
    );
  }

  // 우측 패널 콘텐츠 결정
  let rightPanel;
  if (status === 'idle') {
    rightPanel = <p>이미지를 업로드하거나 카메라로 촬영하여 분석할 수 있습니다.</p>;
  } else if (status === 'analyzing') {
    rightPanel = <p>분석이 진행 중입니다. 잠시만 기다려주세요...</p>;
  } else {
    rightPanel = (
      <div className="results-list">
        {result.results.map((item, idx) => (
          <div key={idx} className="result-item">
            <h4>후보 #{idx + 1}: {item.이름}</h4>
            <p><strong>정보:</strong> {item.정보}</p>
            <p><strong>방제방법:</strong></p>
            <ul>
              {item.방제방법.map((step, i) => <li key={i}>{step}</li>)}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  // 최종 렌더
  return (
    <div className="diagnose-page">
      <header className="page-header">
        <img src={TreeAiDLogo} className="logo" alt="Tree AiD" />
        <div className="page-title-area">
          <h1 className="page-title">수목 병해충 진단 AI</h1>
          <p className="page-subtitle">
            수목 관리 통합 플랫폼 <strong>GreenerLab</strong>의 수목 병해충 진단 AI를 통해 사진을 분석해보세요.
          </p>
        </div>
      </header>

      <div className="panels">
        <div className="panel left-panel">{leftPanel}</div>
        <div className="panel right-panel">
          <h2 className="panel-heading">사용 방법</h2>
          <div className="panel-content">{rightPanel}</div>
        </div>
      </div>
    </div>
  );
}
