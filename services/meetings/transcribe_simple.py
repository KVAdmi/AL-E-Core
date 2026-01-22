#!/usr/bin/env python3
"""
Transcripción simple con Groq Whisper (sin diarización)
Fallback mientras se instala Pyannote
"""

import sys
import json
import os
import tempfile
import subprocess

def convert_to_wav(input_path: str, output_path: str) -> bool:
    """Convierte audio a WAV mono 16kHz"""
    try:
        cmd = [
            'ffmpeg', '-i', input_path,
            '-ar', '16000',
            '-ac', '1',
            '-y',
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return result.returncode == 0
    except Exception as e:
        print(json.dumps({"error": f"Error converting: {str(e)}"}), file=sys.stderr)
        return False

def transcribe_with_groq(wav_path: str) -> str:
    """Transcribe con Groq Whisper via curl"""
    try:
        groq_key = os.environ.get('GROQ_API_KEY')
        if not groq_key:
            raise ValueError("GROQ_API_KEY not set")
        
        # Llamar a Groq API
        cmd = [
            'curl', '-s', '-X', 'POST',
            'https://api.groq.com/openai/v1/audio/transcriptions',
            '-H', f'Authorization: Bearer {groq_key}',
            '-F', f'file=@{wav_path}',
            '-F', 'model=whisper-large-v3-turbo',
            '-F', 'language=es',
            '-F', 'response_format=verbose_json'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        
        if result.returncode != 0:
            raise Exception(f"Groq API error: {result.stderr}")
        
        response = json.loads(result.stdout)
        return response.get('text', '')
        
    except Exception as e:
        print(json.dumps({"error": f"Transcription error: {str(e)}"}), file=sys.stderr)
        return ""

def process_meeting_simple(audio_path: str) -> dict:
    """Transcripción simple sin diarización"""
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Convertir
        wav_path = os.path.join(tmpdir, 'audio.wav')
        print(json.dumps({"status": "converting"}), file=sys.stderr)
        
        if not convert_to_wav(audio_path, wav_path):
            return {"error": "Conversion failed"}
        
        # Transcribir
        print(json.dumps({"status": "transcribing"}), file=sys.stderr)
        text = transcribe_with_groq(wav_path)
        
        if not text:
            return {"error": "Transcription failed"}
        
        # Obtener duración
        duration_cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', 
                       '-of', 'default=noprint_wrappers=1:nokey=1', wav_path]
        duration_result = subprocess.run(duration_cmd, capture_output=True, text=True)
        duration = float(duration_result.stdout.strip()) if duration_result.returncode == 0 else 0
        
        # Retornar como un solo segmento
        return {
            'segments': [{
                'speaker': 'SPEAKER_00',
                'start': 0,
                'end': round(duration, 2),
                'text': text
            }],
            'duration': round(duration, 2),
            'speakers_count': 1
        }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python transcribe_simple.py <audio_file>"}))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}))
        sys.exit(1)
    
    result = process_meeting_simple(audio_path)
    print(json.dumps(result, ensure_ascii=False))
    
    if "error" in result:
        sys.exit(1)
    
    sys.exit(0)

if __name__ == '__main__':
    main()
