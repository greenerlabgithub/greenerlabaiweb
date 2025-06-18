// server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BlobServiceClient } from '@azure/storage-blob';
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { AzureOpenAI } from 'openai';
import decodeUriComponent from 'decode-uri-component';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// ---------------------------------------------
// 1) Azure Blob 설정
const blobSvc = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = blobSvc.getContainerClient(
  process.env.AZURE_STORAGE_CONTAINER
);
console.log('[Init] Azure Blob container ready');

// ---------------------------------------------
// 2) Azure Cognitive Search 설정
const searchClient = new SearchClient(
  process.env.AZURE_SEARCH_ENDPOINT,
  process.env.AZURE_SEARCH_INDEX,
  new AzureKeyCredential(process.env.AZURE_SEARCH_KEY)
);
console.log('[Init] Azure Cognitive Search client ready');

// ---------------------------------------------
// 3) Azure OpenAI 설정
const openai = new AzureOpenAI({
  endpoint:   process.env.AZURE_OPENAI_ENDPOINT,
  apiKey:     process.env.AZURE_OPENAI_KEY,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  azure:      { deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT }
});
console.log('[Init] Azure OpenAI client ready, deployment=', process.env.AZURE_OPENAI_DEPLOYMENT);

// ---------------------------------------------
// 4) 이미지 업로드 유틸
async function uploadToAzure(buffer, ext = 'png') {
  const blobName  = `upload/${Date.now()}.${ext}`;
  console.log(`[uploadToAzure] uploading buffer (${buffer.length} bytes) as ${blobName}`);
  const blockBlob = containerClient.getBlockBlobClient(blobName);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: `image/${ext}` }
  });
  const url = blockBlob.url;
  console.log('[uploadToAzure] uploaded to URL:', url);
  return url;
}

// ---------------------------------------------
// **) Base64 ID → URL → 폴더명(한글+영문) 디코딩 + 추출 헬퍼
function decodeAndExtractName(imageDocumentId) {
  // 1) 원본 Base64 ID
  console.log('[decodeAndExtractName] raw Base64 ID:', imageDocumentId);

  // 2) Base64 → percent-encoded UTF-8
  const percentEncoded = Buffer
    .from(imageDocumentId, 'base64')
    .toString('utf8');
  console.log('[decodeAndExtractName] percentEncoded:', percentEncoded);

  // 3) 전체 URL은 한 번만 디코딩
  const url = decodeURIComponent(percentEncoded);
  console.log('[decodeAndExtractName] decoded URL:', url);

  // 4) percentEncoded 기준으로 imagedata 뒤 폴더명(한글+영문)만 추출
  const after       = percentEncoded.split('/imagedata/')[1] || '';
  const folderSeg   = after.split('/')[0];                // "%EA%B0%80...Dryopteris%20chinensis"
  const name        = decodeURIComponent(folderSeg);      // "가는잎족제비고사리 Dryopteris chinensis"
  console.log('[decodeAndExtractName] extracted name:', name);

  return { url, name };
}


// ---------------------------------------------
// 5) 벡터 검색 → Top 3
async function findTop3(blobUrl) {
  console.log('[findTop3] searching vectors for blobUrl:', blobUrl);
  const response = await searchClient.searchDocuments(
    "*",  // 검색어(필수 문자열)
    {
      vector: {
        fields:     "content_embedding",
        vectorizer: process.env.IMAGE_VECTORIZER,
        imageUrl:   blobUrl,
        k:          3
      },
      select: ["image_document_id", "@search.score"],
      top:     3
    }
  );
  console.log('[findTop3] raw search results:', response.results);

  const docs = response.results.map((r, i) => {
    const encodedId = r.document.image_document_id || "";
    console.log(`[findTop3] result[${i}] encodedId:`, encodedId);

    const { url, name } = decodeAndExtractName(encodedId);
    console.log(`[findTop3] result[${i}] url: ${url}, name: ${name}, score: ${r.score}`);

    return { imageUrl: url, name, score: r.score };
  });

  console.log('[findTop3] mapped docs:', docs);
  return docs;
}

// ---------------------------------------------
// 6) o4-mini(LLM) 호출 유틸
async function fetchEntityInfo(name) {
  console.log('[fetchEntityInfo] prompting LLM for name:', name);
  const prompt = `이름: ${name}
이 곤충 혹은 식물, 수목에 대한 정보를 제공해주세요.
병을 옮기는 병해충이거나 병증을 보이는 식물, 수목의 경우
예시로 어떤 현상을 일으키는지 어떤 방제방법이 있는지 알려주세요.

대답은 JSON 형태로,
{
  "이름": "${name}",
  "정보": "...",
  "방제방법": ["…","…","…"]
}
와 같이 통일해주세요.
`;
  console.log('[fetchEntityInfo] prompt:', prompt);

  const resp = await openai.chat.completions.create({
    model:                 process.env.AZURE_OPENAI_DEPLOYMENT,
    messages:              [{ role: "user", content: prompt }],
    max_completion_tokens: 100000
  });

  const content = resp.choices[0].message.content;
  console.log('[fetchEntityInfo] raw LLM response:', content);

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[fetchEntityInfo] JSON parse fail');
    throw new Error("LLM이 JSON을 반환하지 않았습니다.");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  console.log('[fetchEntityInfo] parsed JSON:', parsed);
  return parsed;
}

// ---------------------------------------------
// 7) 분석 API 엔드포인트
app.post('/api/analyze', async (req, res) => {
  console.log('[API] /api/analyze called, body:', req.body);
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      console.warn('[API] missing imageBase64');
      return res.status(400).json({ error: 'imageBase64가 필요합니다.' });
    }
    console.log('[API] received base64 length:', imageBase64.length);

    // base64 → Buffer, 확장자 결정
    const buffer = Buffer.from(imageBase64, 'base64');
    const ext    = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';
    console.log('[API] buffer created, ext=', ext);

    // A) 업로드
    const blobUrl = await uploadToAzure(buffer, ext);
    // B) 벡터 검색
    const top3    = await findTop3(blobUrl);
    // C) LLM 호출 (병렬)
    const results = await Promise.all(
      top3.map(c => fetchEntityInfo(c.name))
    );
    console.log('[API] final results:', results);

    // D) 응답
    return res.json({ imageUrl: blobUrl, type: 'vector+llm', results });
  } catch (e) {
    console.error('[API] error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------
// 8) 서버 시작
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`[Init] API listening on ${PORT}`));
