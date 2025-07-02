// src/components/ImageAnalyzer.jsx
import React, { useState, useRef } from 'react';
import axios from 'axios';
import './ImageAnalyzer.css';
import loadingGif  from './public/loading.gif';
import ImageIcon   from './public/Image.png';
import CamIcon     from './public/Cam.png';

export default function DiagnosePage() {
  const [status, setStatus]     = useState('idle');        // 'idle' | 'analyzing' | 'done'
  const [result, setResult]     = useState(null);
  const [dragging, setDragging] = useState(false);
  const cameraRef               = useRef(null);
  const galleryRef              = useRef(null);

  // File → Base64
  const toBase64 = file =>
    new Promise((res, rej) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload  = () => res(reader.result.split(',')[1]);
      reader.onerror = rej;
    });

  // AI 분석 호출
  const analyzeImage = async base64 => {
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

  // 파일 처리
  const handleFile = async file => {
    if (!file) return;
    const b64 = await toBase64(file);
    analyzeImage(b64);
  };
  const handleFileChange = e => handleFile(e.target.files[0]);

  // 드래그 앤 드롭
  const onDragEnter = e => { e.preventDefault(); setDragging(true); };
  const onDragLeave = e => { e.preventDefault(); setDragging(false); };
  const onDrop      = e => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  // 카메라/갤러리 열기
  const openCamera  = () => cameraRef.current?.click();
  const openGallery = () => galleryRef.current?.click();

  // 좌측 패널
  let leftPanel;
  if (status === 'idle') {
    leftPanel = (
      <>
        <div
          className={`upload-area ${dragging ? 'dragging' : ''}`}
          onClick={openGallery}
          onDragEnter={onDragEnter}
          onDragOver={e => e.preventDefault()}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <img src={ImageIcon} alt="Upload" />
          <p className="upload-text">
            이곳을 클릭해 파일을 업로드하거나,<br/>
            파일을 드래그로 가져와서 올려주세요.
          </p>
          <p className="upload-note">업로드 가능한 최대 파일 사이즈 : 1GB</p>
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
        {/* GIF 로딩 애니메이션만 표시 */}
        <img src={loadingGif} alt="분석 중" className="loading-gif" />
      </div>
    );
  } else /* done */ {
    leftPanel = (
      <div className="preview-area done">
        <img className="preview-image" src={result.imageUrl} alt="Uploaded" />
      </div>
    );
  }

  // 우측 패널
  let rightPanel;
  if (status === 'idle') {
    rightPanel = <p>이미지를 업로드하거나 카메라로 촬영하여 분석할 수 있습니다.</p>;
  } else if (status === 'analyzing') {
    rightPanel = <p>분석이 진행 중입니다. 잠시만 기다려주세요…</p>;
  } else {
    rightPanel = (
      <div className="results-list">
        {result.results.map((item, i) => (
          <div key={i} className="result-item">
            <h4><span className="result-labela">후보 #{i+1}:</span> {item.이름}</h4>
            <p><span className="result-labelb">정보:</span> {item.정보}</p>
            <p><span className="result-labelc">방제방법:</span><br/></p>
            <ul>
              {item.방제방법.map((step,j) => <li key={j}>{step}</li>)}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`diagnose-page ${status}`}>
      {/* 1️⃣ 헤더는 항상 보이도록 */}
      <header className="page-header">
        <div className="page-title-area">
          <h1 className="page-title">GreenerLab AI</h1>
          <p className="page-subtitle">
            수목 관리 통합 플랫폼 <strong>GreenerLab</strong>의 병해충 진단 AI로<br/>
            촬영·업로드된 이미지를 분석해 보세요.
          </p>
        </div>
      </header>

      {/* 2️⃣ 패널은 언제나 가로(row) 정렬 */}
      <div className="panels">
        <div className="panel left-panel">{leftPanel}</div>
        <div className="panel right-panel">
          <h2 className="panel-heading">답변</h2>
          <div className="panel-content">{rightPanel}</div>
        </div>
      </div>
    </div>
  );
}
