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

// 기존 webDetect 함수 자리에 아래 코드로 덮어쓰기
async function webDetect(buffer) {
  const [res] = await visionClient.webDetection({ image: { content: buffer } });
  const wd = res.webDetection || {};

  // ① Web Entities 이름만 추출
  //    예: ["장미등에잎벌", "극동등에잎벌", "장미등에잎벌", …]
  const entitiesRaw = wd.webEntities
    ? wd.webEntities.map(e => e.description).filter(Boolean)
    : [];

  // ② 등장 횟수 계산 (빈도수)
  const freqMap = {};
  for (const ent of entitiesRaw) {
    freqMap[ent] = (freqMap[ent] || 0) + 1;
  }
  // ③ 빈도수 기준 내림차순 정렬된 엔티티 리스트
  //    예: ["장미등에잎벌", "극동등에잎벌", …]
  const sortedEntities = Object.entries(freqMap)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);

  // ④ 원본 visuallySimilarImages URL 목록
  const allSimilar = wd.visuallySimilarImages
    ? wd.visuallySimilarImages.map(i => i.url)
    : [];

  // ⑤ “국내용 도메인” 필터링 (.kr, naver.com, daum.net 등)
  const koreanSimilar = allSimilar.filter(url => {
    try {
      const host = new URL(url).hostname;
      return (
        host.endsWith('.kr') ||
        host.includes('naver.com') ||
        host.includes('daum.net')
      );
    } catch {
      return false;
    }
  });

  // ⑥ 국내 필터링만 모아도 3개 미만이면, 부족분을 allSimilar에서 채움
  const topSimilar = [...koreanSimilar];
  for (const url of allSimilar) {
    if (topSimilar.length >= 3) break;
    if (!topSimilar.includes(url)) {
      topSimilar.push(url);
    }
  }
  const filteredSimilar = topSimilar.slice(0, 3);

  // ⑦ 디버그용 로그 출력
  console.log('--- WebDetect Debug ---');
  console.log('1) 원본 visuallySimilarImages URLs:', allSimilar);
  console.log('2) 국내 필터링된 URLs (koreanSimilar):', koreanSimilar);
  console.log('3) 최종 top 3 visually similar:', filteredSimilar);
  console.log('4) Web Entities 빈도 순 (sortedEntities):', sortedEntities);
  console.log('5) Best-Guess Labels:', wd.bestGuessLabels?.map(l => l.label) || []);
  console.log('-----------------------\n');

  return {
    bestGuess:       wd.bestGuessLabels?.map(l => l.label) || [],
    entities:        wd.webEntities?.map(e => e.description) || [],
    allSimilar,      // (디버깅용으로 client에 반환할 수도 있음)
    filteredSimilar, // 국내 필터링 후 상위 3개 URL
    sortedEntities   // 엔티티별 빈도 순 후보 라벨
  };
}


// 3) Gemini에 Web Detection 결과+이미지 원본을 넘겨서 JSON 파싱
async function analyzeWithLensLike(buffer, webInfo) {
  const b64 = buffer.toString('base64');
  const imagePart = { inline_data: { data: b64, mimeType:'image/jpeg' } };
  // analyzeWithLensLike 함수에 추가/변경할 부분
// webDetect 반환값에 이미 bestGuess가 포함되어 있으므로 별도 수정 불필요

// analyzeWithLensLike 함수 내, “빈도 순 후보” 대신 “Best-Guess 상위 3개”를 사용하도록 변경

const top3Candidates = [
  webInfo.bestGuess[0] || '없음',
  webInfo.bestGuess[1] || '없음',
  webInfo.bestGuess[2] || '없음'
];

const textPart = {
  text: `
모든 답변을 반드시 **한국어** 로만 작성해 주세요.

아래 3개 라벨은 Vision API의 Best-Guess Labels 상위 3개입니다:
1) ${top3Candidates[0]}
2) ${top3Candidates[1]}
3) ${top3Candidates[2]}

이 3가지 후보를 참고하여, JSON 배열로 **3가지 병해충(혹은 증상) 후보**와
각 후보마다 **피해 원인(cause)** 과 **방제 방법(remedy)** 3가지씩을
아래 구조 그대로 출력해 주세요. (다른 텍스트 절대 금지)

[
  {
    "pest": "첫 번째 병해충 이름",
    "cause": ["원인1","원인2","원인3"],
    "remedy": ["방제1","방제2","방제3"]
  },
  {
    "pest": "두 번째 병해충 이름",
    "cause": ["원인1","원인2","원인3"],
    "remedy": ["방제1","방제2","방제3"]
  },
  {
    "pest": "세 번째 병해충 이름",
    "cause": ["원인1","원인2","원인3"],
    "remedy": ["방제1","방제2","방제3"]
  }
]
`
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
