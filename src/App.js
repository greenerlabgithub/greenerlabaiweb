// src/App.js
import ImageAnalyzer from './components/ImageAnalyzer';
// components/public 안에 두셨다면 이 경로로, 
// assets 폴더에 두셨다면 '../assets/TreeAiD.png' 로 변경하세요.
import Logo from './components/public/TreeAiD.png';

function App() {
  return (
    <div style={{ padding: 20 }}>
      <h1
        style={{
          display: 'flex',
          alignItems: 'center',
          color: '#00A57F',       // 로고와 같은 색상으로 변경
          fontSize: '2rem',
          margin: 0
        }}
      >
        <img
          src={Logo}
          alt="TreeAiD Logo"
          style={{
            width: 32,
            height: 'auto',
            marginRight: 8
          }}
        />
        TreeAiD
      </h1>
      <ImageAnalyzer />
    </div>
  );
}

export default App;
