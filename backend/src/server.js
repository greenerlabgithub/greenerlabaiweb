// server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BlobServiceClient } from '@azure/storage-blob';
import { AzureKeyCredential } from '@azure/search-documents';
import axios from 'axios';
import { AzureOpenAI } from 'openai';
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
// 2) Azure OpenAI 설정
const openai = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiKey: process.env.AZURE_OPENAI_KEY,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
  azure: { deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT }
});
console.log('[Init] Azure OpenAI client ready, deployment=', process.env.AZURE_OPENAI_DEPLOYMENT);

// ---------------------------------------------
// 3) 이미지 업로드 유틸
async function uploadToAzure(buffer, ext = 'png') {
  const blobName = `upload/${Date.now()}.${ext}`;
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
// 4) (REST) 벡터 검색 호출 헬퍼
async function vectorSearchREST(rawBase64) {
  // 슬래시 스타일 인덱스 경로 사용
  const url = `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${process.env.AZURE_SEARCH_INDEX}/docs/search?api-version=2025-05-01-preview`;
  const body = {
    search: "*",
    count: true,
    vectorQueries: [{
      kind: "imageBinary",
      fields: "content_embedding",
      base64Image: rawBase64,
      k: 3
    }],
    select: ["*"],
    queryType: "semantic",
    semanticConfiguration: "multimodal-rag-imagedatavoctor-semantic-configuration",
    captions: "extractive",
    answers: "extractive|count-3",
    queryLanguage: "en-us",
    top: 3
  };
  try {
    const resp = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.AZURE_SEARCH_KEY
      }
    });
    return resp.data;
  } catch (err) {
    console.error('[vectorSearchREST] status:', err.response?.status);
    console.error('[vectorSearchREST] error body:', JSON.stringify(err.response?.data, null, 2));
    throw new Error('벡터 검색 요청이 실패했습니다. 상세 로그를 확인하세요.');
  }
}


// ---------------------------------------------
// 5) Base64 ID → URL → 폴더명(한글+영문) 디코딩 헬퍼
function decodeAndExtractName(imageDocumentId) {
  console.log('[decodeAndExtractName] raw Base64 ID:', imageDocumentId);
  const percentEncoded = Buffer.from(imageDocumentId, 'base64').toString('utf8');
  console.log('[decodeAndExtractName] percentEncoded:', percentEncoded);
  const url = decodeURIComponent(percentEncoded);
  console.log('[decodeAndExtractName] decoded URL:', url);
  const after = percentEncoded.split('/imagedata/')[1] || '';
  const folderSeg = after.split('/')[0];
  const name = decodeURIComponent(folderSeg);
  console.log('[decodeAndExtractName] extracted name:', name);
  return { url, name };
}

// ---------------------------------------------
// 6) 벡터 검색 → Top 3
async function findTop3(imageBase64) {
  const rawBase64 = imageBase64.replace(/^data:\w+\/\w+;base64,/, "");
  const preview = rawBase64.length > 30 ? `${rawBase64.slice(0, 30)}…` : rawBase64;
  console.log(`[findTop3] REST vector search preview: ${preview}`);

  const { value: rawDocs, "@odata.count": total } = await vectorSearchREST(rawBase64);
  console.log(`[findTop3] REST returned ${total} docs, using top ${rawDocs.length}`);

  const docs = rawDocs.map((doc) => {
    const encodedId = doc.image_document_id || "";
    const { url, name } = decodeAndExtractName(encodedId);
    return { imageUrl: url, name, score: doc['@search.score'] };
  });

  console.log('[findTop3] mapped docs:', docs);
  return docs;
}

// ---------------------------------------------
// 7) o4-mini(LLM) 호출 유틸
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
    model: process.env.AZURE_OPENAI_DEPLOYMENT,
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: 100000
  });
  const content = resp.choices[0].message.content;
  console.log('[fetchEntityInfo] raw LLM response:', content);

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[fetchEntityInfo] JSON parse fail');
    throw new Error('LLM이 JSON을 반환하지 않았습니다.');
  }
  const parsed = JSON.parse(jsonMatch[0]);
  console.log('[fetchEntityInfo] parsed JSON:', parsed);
  return parsed;
}

// ---------------------------------------------
// 8) 분석 API 엔드포인트
app.post('/api/analyze', async (req, res) => {
  console.log('[API] /api/analyze called, body:', req.body);
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      console.warn('[API] missing imageBase64');
      return res.status(400).json({ error: 'imageBase64가 필요합니다.' });
    }
    console.log('[API] received base64 length:', imageBase64.length);

    const buffer = Buffer.from(imageBase64, 'base64');
    const ext = imageBase64.startsWith('iVBOR') ? 'png' : 'jpg';
    console.log('[API] buffer created, ext=', ext);

    const blobUrl = await uploadToAzure(buffer, ext);
    const top3 = await findTop3(imageBase64);
    const results = await Promise.all(top3.map(c => fetchEntityInfo(c.name)));
    console.log('[API] final results:', results);

    return res.json({ imageUrl: blobUrl, type: 'vector+llm', results });
  } catch (e) {
    console.error('[API] error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------
// 9) 서버 시작
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`[Init] API listening on ${PORT}`));
