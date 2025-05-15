import base64
import logging
import json
from io import BytesIO
from PIL import Image
from google import genai
from google.genai import types
import azure.functions as func
import os

API_KEY = os.getenv("GOOGLE_API_KEY")
logger = logging.getLogger("greenerlabai")
logger.setLevel(logging.DEBUG)

def part_from_image_bytes(image_data: bytes):
    img = Image.open(BytesIO(image_data))
    fmt = img.format  # e.g. 'JPEG', 'PNG', 'GIF', ...
    mime_type = Image.MIME.get(fmt, "image/jpeg")
    logger.debug("Detected image format: %s → %s", fmt, mime_type)
    return types.Part.from_bytes(data=image_data, mime_type=mime_type)

def generate(image_datas: list[bytes], additional_info: str):
    client = genai.Client(api_key=API_KEY)
    model_id = "gemini-2.0-flash-001"

    # 텍스트 + 이미지 파트 조합
    parts = [
        types.Part.from_text(text=(
            "이 이미지는 수목 혹은 식물에 영향을 주는 곤충 혹은 증상이 발현한 병증입니다. "
            f"{additional_info}"
        ))
    ]
    for img_bytes in image_datas:
        parts.append(part_from_image_bytes(img_bytes))

    contents = [ types.Content(role="user", parts=parts) ]

    tools = [ types.Tool(google_search=types.GoogleSearch()) ]
    config = types.GenerateContentConfig(
#        temperature=0,
        top_p=0.5,
#       top_k=20,
#        candidate_count=1,
#        seed=5,
#        max_output_tokens=100,
#        stop_sequences=["STOP!"],
#        presence_penalty=0.0,
#        frequency_penalty=0.0,
        safety_settings=[
            types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_ONLY_HIGH"),
            types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH",  threshold="BLOCK_ONLY_HIGH"),
            types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_LOW_AND_ABOVE"),
            types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_ONLY_HIGH"),
        ],
        tools=tools,
        response_mime_type="text/plain",
        system_instruction=[
            types.Part.from_text(text="""이 이미지들은 같은 수목 혹은 식물에 영향을 주는 곤충 혹은 증상이 발현한 병증입니다.
이미지들을 확인하고 곤충 혹은 병증을 분석 및 추출하여 검색엔진에서 가장 유사한 정보를 찾아냅니다.
먼저 Google Search를 통해 가장 유사한 이미지 혹은 오브젝트를 찾아 정보를 추출합니다.
유사한 이미지 혹은 오브젝트를 찾지 못할 경우 예상되는 리스트를 알려줍니다.
기본적인 정보는 아래 폼과 같이 전달됩니다. 
  - 수목 혹은 식물 : 촬영된 부위 : 현재 증상 : 
가장 유사한 정보를 찾을 경우 답변을 아래 폼과 같이 정리해줍니다. 
  - 병해충 혹은 증상 : 병해충 혹은 증상의 자세한 정보 : 방제 및 처리 방법 :
뱡해충 혹은 증상은 유사한 것으로 3가지를 알려줍니다.
가장 유사한 정보를 병해충 혹은 증상의 자세한 정보 : 방제 및 처리 방법 : 에 작성합니다."""),
        ],
    )

    response = client.models.generate_content(
        model=model_id,
        contents=contents,
        config=config
    )
    return response.text

def main(req: func.HttpRequest, context: func.Context) -> func.HttpResponse:
    logger.info("Invocation ID=%s: 요청 수신", context.invocation_id)
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "잘못된 JSON 형식입니다."}, ensure_ascii=False),
            status_code=400,
            headers={"Content-Type": "application/json"}
        )

    image_datas = []
    for key in ("imageData1", "imageData2", "imageData3"):
        b64 = body.get(key)
        if b64:
            try:
                image_datas.append(base64.b64decode(b64))
            except Exception:
                return func.HttpResponse(
                    json.dumps({"error": f"{key} 필드의 Base64 문자열이 잘못되었습니다."}, ensure_ascii=False),
                    status_code=400,
                    headers={"Content-Type": "application/json"}
                )

    if not (1 <= len(image_datas) <= 3):
        return func.HttpResponse(
            json.dumps({"error": "imageData1~3 중 최소 1개, 최대 3개의 이미지를 전달해주세요."}, ensure_ascii=False),
            status_code=400,
            headers={"Content-Type": "application/json"}
        )

    additional_info = body.get("additionalInfo", "")

    try:
        result_text = generate(image_datas, additional_info)
        # JSON으로 포장
        return func.HttpResponse(
            json.dumps({"result": result_text, "Status": "Success"}, ensure_ascii=False),
            status_code=200,
            headers={"Content-Type": "application/json"}
        )
    except Exception as e:
        logger.exception("처리 중 예외 발생")
        return func.HttpResponse(
            json.dumps({"error": str(e)}, ensure_ascii=False),
            status_code=500,
            headers={"Content-Type": "application/json"}
        )
