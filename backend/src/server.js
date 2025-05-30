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

아래 이미지를 분석하여, **3가지 병해충(또는 증상) 후보**를 뽑고,
각 후보마다 **피해 원인(cause)** 과 **방제 방법(remedy)** 3가지씩을
JSON 배열 형식으로 출력해 주세요.  
국내에 서식하는 병해충, 국내에서 발생하는 병증 위주의 답변을 합니다.
병해충의 경우 어떤 종의 어떤 것인지 유사한 것으로 찾아서 답변합니다. 예) 선녀벌레(뾰족날개선녀벌레) 
병증의 경우 어떤 수목인지 먼저 파악하고 해당 수목에서 많이 발생하는 병증 위주로 찾아서 답변합니다. 예) 철쭉 - 떡병, 민떡병 등등 - 민떡병

반드시 아래와 같은 구조로 응답해 주세요(다른 텍스트는 일절 금지):

[
  {
    "pest": "첫 번째 병해충 이름",
    "cause": [
      "첫 번째 원인",
      "두 번째 원인",
      "세 번째 원인"
    ],
    "remedy": [
      "첫 번째 방제 방법",
      "두 번째 방제 방법",
      "세 번째 방제 방법"
    ]
  },
  {
    "pest": "두 번째 병해충 이름",
    "cause": [
      "...",
      "...",
      "..."
    ],
    "remedy": [
      "...",
      "...",
      "..."
    ]
  },
  {
    "pest": "세 번째 병해충 이름",
    "cause": [
      "...",
      "...",
      "..."
    ],
    "remedy": [
      "...",
      "...",
      "..."
    ]
  }
]`
  };

  const contents = [{ role:'user', parts:[ textPart, imagePart ] }];
  const config   = {
    tools: [{ googleSearch: {} }],
    responseMimeType:'application/json'
  };
  const result = await genModel.generateContent({ contents, config });
  const raw = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('Raw Gemini response:', raw);

  // 1) JSON 배열 블록 추출 시도
  let jsonString = '';
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    jsonString = arrayMatch[0];
  } else {
    // 2) 배열이 없으면 객체 추출
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (!objMatch) {
      throw new Error('Gemini가 JSON을 반환하지 않았습니다.');
    }
    jsonString = objMatch[0];
  }

  // 3) trailing comma 제거
  jsonString = jsonString.replace(/,\s*([\]}])/g, '$1');

  // 4) 파싱
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error('JSON 파싱 실패:', e);
    console.error('문제의 JSON 문자열:', jsonString);
    throw e;
  }
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
    const predictions = await analyzeWithLensLike(buffer, webInfo);
    return res.json({ imageUrl, predictions });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, ()=>console.log(`✅ API on ${PORT}`));
