// src/App.js
import ImageAnalyzer from './components/ImageAnalyzer';
// components/public 안에 두셨다면 이 경로로, 
import Logo from './components/public/TreeAiD.png';

function App() {
  return (
    <div style={{ padding: 20 }}>
        <img
          src={Logo}
          alt="TreeAiD Logo"
          style={{
            width: 170,
            height: 'auto',
            marginRight: 8
          }}
        />
      <ImageAnalyzer />
    </div>
  );
}

export default App;
