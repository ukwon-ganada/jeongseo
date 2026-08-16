FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py .

# Cloud Run 이 PORT 를 넣어 준다
ENV PORT=8080
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
