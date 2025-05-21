import React from 'react';
import ImageAnalyzer from './components/ImageAnalyzer';  // ← 경로 주의!

function App() {
  return (
    <div className="App">
      <ImageAnalyzer />  {/* 여기서 컴포넌트를 렌더링 */}
    </div>
  );
}

export default App;

