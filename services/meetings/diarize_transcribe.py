#!/usr/bin/env python3
"""
Servicio de diarización + transcripción para reuniones
Input: path a archivo de audio
Output: JSON con segmentos {speaker, start, end, text}
"""

import sys
import json
import os
import tempfile
import subprocess
from pathlib import Path

def convert_to_wav(input_path: str, output_path: str) -> bool:
    """Convierte audio a WAV mono 16kHz usando ffmpeg"""
    try:
        cmd = [
            'ffmpeg', '-i', input_path,
            '-ar', '16000',  # 16kHz
            '-ac', '1',      # mono
            '-y',            # overwrite
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return result.returncode == 0
    except Exception as e:
        print(json.dumps({"error": f"Error converting audio: {str(e)}"}), file=sys.stderr)
        return False

def diarize_audio(wav_path: str):
    """Ejecuta pyannote para diarización"""
    try:
        from pyannote.audio import Pipeline
        
        # Requiere HF_TOKEN en env
        hf_token = os.environ.get('HF_TOKEN')
        if not hf_token:
            raise ValueError("HF_TOKEN no configurado en environment")
        
        # Cargar pipeline de diarización
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token
        )
        
        # Ejecutar diarización
        diarization = pipeline(wav_path)
        
        # Convertir a lista de turnos
        turns = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            turns.append({
                'speaker': speaker,
                'start': turn.start,
                'end': turn.end
            })
        
        return turns
    
    except Exception as e:
        print(json.dumps({"error": f"Error in diarization: {str(e)}"}), file=sys.stderr)
        return None

def extract_segment(input_wav: str, start: float, end: float, output_path: str) -> bool:
    """Extrae segmento de audio usando ffmpeg"""
    try:
        duration = end - start
        cmd = [
            'ffmpeg', '-i', input_wav,
            '-ss', str(start),
            '-t', str(duration),
            '-y',
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return result.returncode == 0
    except Exception as e:
        print(json.dumps({"error": f"Error extracting segment: {str(e)}"}), file=sys.stderr)
        return False

def transcribe_segment(wav_path: str) -> str:
    """Transcribe segmento con faster-whisper"""
    try:
        from faster_whisper import WhisperModel
        
        # Usar modelo small (balance speed/accuracy)
        # Opciones: tiny, base, small, medium, large-v3
        model = WhisperModel("small", device="cpu", compute_type="int8")
        
        segments, info = model.transcribe(wav_path, language="es", beam_size=5)
        
        # Unir todos los segmentos en un texto
        text = " ".join([segment.text.strip() for segment in segments])
        return text.strip()
    
    except Exception as e:
        print(json.dumps({"error": f"Error transcribing: {str(e)}"}), file=sys.stderr)
        return ""

def process_meeting(audio_path: str) -> dict:
    """Pipeline completo: convierte, diariza, transcribe por segmento"""
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Paso 1: Convertir a WAV mono 16k
        wav_path = os.path.join(tmpdir, 'audio.wav')
        print(json.dumps({"status": "converting"}), file=sys.stderr)
        
        if not convert_to_wav(audio_path, wav_path):
            return {"error": "Failed to convert audio"}
        
        # Paso 2: Diarización
        print(json.dumps({"status": "diarizing"}), file=sys.stderr)
        turns = diarize_audio(wav_path)
        
        if turns is None:
            return {"error": "Diarization failed"}
        
        if len(turns) == 0:
            return {"error": "No speakers detected"}
        
        print(json.dumps({"status": "diarization_complete", "turns": len(turns)}), file=sys.stderr)
        
        # Paso 3: Transcribir cada turno
        print(json.dumps({"status": "transcribing_segments"}), file=sys.stderr)
        
        segments = []
        for idx, turn in enumerate(turns):
            # Extraer segmento
            segment_path = os.path.join(tmpdir, f'segment_{idx}.wav')
            
            if not extract_segment(wav_path, turn['start'], turn['end'], segment_path):
                # Si falla extracción, skip este segmento
                continue
            
            # Transcribir segmento
            text = transcribe_segment(segment_path)
            
            if text:
                segments.append({
                    'speaker': turn['speaker'],
                    'start': round(turn['start'], 2),
                    'end': round(turn['end'], 2),
                    'text': text
                })
            
            # Log progreso cada 10 segmentos
            if (idx + 1) % 10 == 0:
                print(json.dumps({
                    "status": "transcribing", 
                    "progress": f"{idx + 1}/{len(turns)}"
                }), file=sys.stderr)
        
        # Resultado final
        duration = turns[-1]['end'] if turns else 0
        
        return {
            'segments': segments,
            'duration': round(duration, 2),
            'speakers_count': len(set(s['speaker'] for s in segments))
        }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python diarize_transcribe.py <audio_file>"}))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    
    if not os.path.exists(audio_path):
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)
    
    # Procesar
    result = process_meeting(audio_path)
    
    # Output JSON a stdout
    print(json.dumps(result, ensure_ascii=False))
    
    if "error" in result:
        sys.exit(1)
    
    sys.exit(0)

if __name__ == '__main__':
    main()
