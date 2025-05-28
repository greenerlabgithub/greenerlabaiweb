// server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BlobServiceClient } from '@azure/storage-blob';
import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();
const app  = express();
const PORT = process.env.PORT || 4000;

// Azure Blob 초기화
const blobSvc         = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = blobSvc.getContainerClient(
  process.env.AZURE_STORAGE_CONTAINER
);

// Vertex AI 초기화 (모델명은 절대 변경 금지)
const vertexAI = new VertexAI({
  project:  process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.VERTEX_LOCATION
});
const genModel = vertexAI.getGenerativeModel({
  publisher: 'google',
  model:     'gemini-2.0-flash-001',   // ← 변경하지 마세요!
  safetySettings: [
    {
      category:  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_HIGH
    }
  ],
  generationConfig: { maxOutputTokens: 1024 }
});

// 미들웨어
app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

// Azure Blob에 이미지 업로드
async function uploadToAzure(buffer, ext) {
  const name = `upload/${Date.now()}_${uuidv4()}.${ext}`;
  const block = containerClient.getBlockBlobClient(name);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return block.url;
}

// 이미지 원본만으로 분석: pest / cause / remedy
async function analyzeImageWithGemini(buffer) {
  const b64       = buffer.toString('base64');
  const imagePart = { inline_data: { data: b64, mimeType: 'image/jpeg' } };
  const textPart  = {
    text: `
위 이미지는 수목의 병해충 또는 증상을 촬영한 것입니다.
이미지 자체만 보고 아래 JSON 형식으로 정확히 출력해 주세요:
{
  "pest":   "병해충 이름 또는 증상",
  "cause":  "피해 원인",
  "remedy": "방제 방법"
}`
  };

  const contents = [{ role: 'user', parts: [ textPart, imagePart ] }];
  const config   = {
    tools: [{ googleSearch: {} }],          // 필요 시 웹 검색 허용
    responseMimeType: 'application/json'
  };

  const result = await genModel.generateContent({ contents, config });
  const raw    = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('Raw Gemini response:', raw);

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini가 JSON을 반환하지 않았습니다.');
  return JSON.parse(match[0]);
}

// 엔드포인트
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64(이미지 Base64) 필수입니다.' });
    }

    // 1) Base64 → Buffer
    const buffer = Buffer.from(imageBase64, 'base64');
    const ext    = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';

    // 2) (선택) Azure Blob에 저장
    const imageUrl = await uploadToAzure(buffer, ext);

    // 3) Gemini Pro Vision 분석
    const { pest, cause, remedy } = await analyzeImageWithGemini(buffer);

    // 4) 결과 반환
    return res.json({ imageUrl, pest, cause, remedy });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`✅ API listening on port ${PORT}`);
});
