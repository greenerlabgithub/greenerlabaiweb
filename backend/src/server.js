// server.js
import express                   from 'express';
import cors                      from 'cors';
import bodyParser                from 'body-parser';
import { BlobServiceClient }     from '@azure/storage-blob';
import vision                    from '@google-cloud/vision';
import VertexAIPkg               from '@google-cloud/vertexai';   // default import
import axios                     from 'axios';
import dotenv                    from 'dotenv';
import { v4 as uuidv4 }         from 'uuid';

dotenv.config();
const app  = express();
const PORT = process.env.PORT || 4000;

// CommonJS 모듈에서 필요한 부분만 꺼내기
const {
  VertexAI,
  HarmCategory,
  HarmBlockThreshold,
  types: GenTypes
} = VertexAIPkg;

// 미들웨어
app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

// Azure Blob 초기화
const blobSvc         = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = blobSvc.getContainerClient(
  process.env.AZURE_STORAGE_CONTAINER
);

// GCP Vision & Vertex AI 초기화
const visionClient = new vision.ImageAnnotatorClient();
const vertexAI     = new VertexAI({
  project:  process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.VERTEX_LOCATION,
});
const genModel = vertexAI.getGenerativeModel({
  publisher: 'google',
  model:     'gemini-pro-vision',
  safetySettings: [
    {
      category:  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_HIGH
    }
  ],
  generationConfig: { maxOutputTokens: 1024 }
});

// 이미지를 Azure Blob에 저장
async function uploadToAzure(buffer, ext) {
  const blobName = `upload/${Date.now()}_${uuidv4()}.${ext}`;
  const block    = containerClient.getBlockBlobClient(blobName);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return block.url;
}

// Gemini Pro Vision 모델에 이미지와 프롬프트를 전달해 JSON 응답을 파싱
async function analyzeImageWithGemini(buffer) {
  // Part 생성
  const imagePart = GenTypes.Part.fromBytes({
    data:     buffer,
    mimeType: 'image/jpeg'
  });
  const textPart = GenTypes.Part.fromText({
    text: `이 이미지는 수목의 병해충 또는 증상을 촬영한 것입니다.
아래 이미지에 나타난 병해충/병증 이름과 피해 원인, 방제 방법을
JSON 형식으로 정확히 출력해 주세요:
{"pest": "", "cause": "", "remedy": ""}`
  });

  const contents = [{ role: 'user', parts: [textPart, imagePart] }];
  const config   = GenTypes.GenerateContentConfig.fromPartial({
    tools: [
      GenTypes.Tool.fromPartial({ googleSearch: {} })
    ],
    responseMimeType: 'application/json'
  });

  const result = await genModel.generateContent({ contents, config });
  const raw    = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('Raw Gemini response:', raw);

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini가 JSON을 반환하지 않았습니다.');
  return JSON.parse(match[0]);
}

// 메인 엔드포인트
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 필수입니다.' });
    }

    // Base64 → Buffer
    const buffer = Buffer.from(imageBase64, 'base64');
    const ext    = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';
    // 1) Blob 저장
    const imageUrl = await uploadToAzure(buffer, ext);
    // 2) Gemini 분석
    const { pest, cause, remedy } = await analyzeImageWithGemini(buffer);

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
