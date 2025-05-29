// server.js
import express                    from 'express';
import cors                       from 'cors';
import bodyParser                 from 'body-parser';
import { BlobServiceClient }      from '@azure/storage-blob';
import vision                     from '@google-cloud/vision';
import VertexAIPkg                from '@google-cloud/vertexai';
import dotenv                     from 'dotenv';
import { v4 as uuidv4 }           from 'uuid';

dotenv.config();
const app  = express();
const PORT = process.env.PORT || 4000;
const { VertexAI, HarmCategory, HarmBlockThreshold } = VertexAIPkg;

// Azure Blob 초기화
const blobSvc         = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobSvc.getContainerClient(process.env.AZURE_STORAGE_CONTAINER);

// GCP 클라이언트
const visionClient = new vision.ImageAnnotatorClient();
const vertexAI     = new VertexAI({
  project:  process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.VERTEX_LOCATION,
});
const genModel = vertexAI.getGenerativeModel({
  publisher: 'google',
  model:     'gemini-2.0-flash-001',   // 절대 변경 금지
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_HIGH }
  ],
  generationConfig: { maxOutputTokens: 1024 }
});

app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));

// 1) 파일 업로드 헬퍼
async function uploadToAzure(buffer, ext) {
  const name  = `upload/${Date.now()}_${uuidv4()}.${ext}`;
  const block = containerClient.getBlockBlobClient(name);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  return block.url;
}

// 2) Vision Web Detection
async function webDetect(buffer) {
  const [res] = await visionClient.webDetection({ image:{ content: buffer } });
  const wd   = res.webDetection || {};
  return {
    bestGuess: wd.bestGuessLabels?.map(l => l.label) || [],
    entities:  wd.webEntities?.map(e => e.description) || [],
    similar:   wd.visuallySimilarImages?.map(i => i.url) || []
  };
}

// 3) Gemini에 Web Detection 결과+이미지 원본을 넘겨서 JSON 파싱
async function analyzeWithLensLike(buffer, webInfo) {
  const b64 = buffer.toString('base64');
  const imagePart = { inline_data: { data: b64, mimeType:'image/jpeg' } };
  const textPart  = {
    text: `
아래 정보는 Google Lens의 Web Detection 결과입니다.
Best-Guess Labels: ${webInfo.bestGuess.join(', ') || '없음'}
Web Entities: ${webInfo.entities.join(', ') || '없음'}
Similar Images: 
${webInfo.similar.slice(0,5).join('\n') || '없음'}

이 정보와 원본 이미지를 바탕으로, JSON 형식으로 아래 세 필드를 정확히 작성해 주세요:
{
  "pest":   "병해충 이름 또는 증상",
  "cause":  "피해 원인",
  "remedy": "방제 방법"
}`
  };

  const contents = [{ role:'user', parts:[ textPart, imagePart ] }];
  const config   = {
    tools: [{ googleSearch: {} }],
    responseMimeType:'application/json'
  };
  const result = await genModel.generateContent({ contents, config });
  const raw    = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('Raw Lens-like JSON:', raw);

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON 블록을 못 찾았습니다.');
  return JSON.parse(match[0]);
}

// 엔드포인트
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error:'imageBase64 필요' });

    // A) 업로드
    const buffer   = Buffer.from(imageBase64,'base64');
    const ext      = imageBase64.startsWith('iVBOR')?'png':'jpg';
    const imageUrl = await uploadToAzure(buffer, ext);

    // B) WebDetection
    const webInfo = await webDetect(buffer);

    // C) LLM + WebDetection → JSON 파싱
    const { pest, cause, remedy } = await analyzeWithLensLike(buffer, webInfo);

    return res.json({ imageUrl, bestGuess:webInfo.bestGuess, entities:webInfo.entities, similar:webInfo.similar, pest, cause, remedy });

  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, ()=>console.log(`✅ API on ${PORT}`));
