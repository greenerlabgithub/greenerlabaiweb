// server.js
import express          from 'express';
import cors             from 'cors';
import bodyParser       from 'body-parser';
import { BlobServiceClient } from '@azure/storage-blob';
import vision           from '@google-cloud/vision';
import {
  VertexAI, HarmCategory, HarmBlockThreshold,
  types as GenTypes
} from '@google-cloud/vertexai';
import axios            from 'axios';
import dotenv           from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();
const app  = express();
const PORT = process.env.PORT || 4000;

// --- 미들웨어 설정 ---
app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

// --- Azure Blob 초기화 ---
const blobSvc         = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = blobSvc.getContainerClient(
  process.env.AZURE_STORAGE_CONTAINER
);

// --- GCP Vision & Vertex AI 초기화 ---
const visionClient = new vision.ImageAnnotatorClient();
const vertexAI     = new VertexAI({
  project:  process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.VERTEX_LOCATION,
});
const genModel = vertexAI.getGenerativeModel({
  publisher: 'google',                  // Model Garden 퍼블리셔
  model:     'gemini-pro-vision',       // 이미지 입력 지원 모델
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_HIGH }
  ],
  generationConfig: { maxOutputTokens: 1024 }
});

// --- 이미지 업로드 헬퍼 ---
async function uploadToAzure(buffer, ext) {
  const blobName = `upload/${Date.now()}_${uuidv4()}.${ext}`;
  const block    = containerClient.getBlockBlobClient(blobName);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return block.url;
}

// --- 이미지 기반 분석 헬퍼 (LLM + Google Search 툴) ---
async function analyzeImageWithGemini(buffer) {
  // 1) 이미지 바이트 → Generative AI용 Part
  const imagePart = GenTypes.Part.fromBytes({
    data:     buffer,
    mimeType: 'image/jpeg'
  });
  // 2) 프롬프트 Part (간단히 의도 전달)
  const textPart  = GenTypes.Part.fromText({
    text: `이 이미지는 수목의 병해충 또는 증상을 촬영한 것입니다. 
아래 이미지에 나타난 병해충/병증 이름과,
피해 원인, 방제 방법을 JSON 형식으로 출력해 주세요:
{
  "pest": "",
  "cause": "",
  "remedy": ""
}`
  });

  const contents = [{
    role:  'user',
    parts: [ textPart, imagePart ]
  }];

  // 3) 도구(tool)로 Google Search 사용 권한 부여
  const config = GenTypes.GenerateContentConfig.fromPartial({
    tools: [
      GenTypes.Tool.fromPartial({ googleSearch: {} })
    ],
    responseMimeType: 'application/json'
  });

  // 4) 모델 호출
  const result = await genModel.generateContent({
    contents,
    config
  });

  // 5) 원시 텍스트 꺼내기
  const raw = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('Raw Gemini response:', raw);

  // 6) JSON 블록만 추출 & 파싱
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini가 JSON을 반환하지 않았습니다.');
  return JSON.parse(match[0]);
}

// --- 메인 엔드포인트 ---
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 필수입니다.' });
    }

    // Base64 → Buffer
    const buffer = Buffer.from(imageBase64, 'base64');
    // 파일 확장자 추측
    const ext = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';
    // 1) Blob 저장
    const imageUrl = await uploadToAzure(buffer, ext);

    // 2) 이미지 기반 분석
    const { pest, cause, remedy } = await analyzeImageWithGemini(buffer);

    // 3) 응답
    return res.json({
      imageUrl,
      pest,
      cause,
      remedy
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// --- 서버 시작 ---
app.listen(PORT, () => {
  console.log(`✅ API listening on port ${PORT}`);
});
