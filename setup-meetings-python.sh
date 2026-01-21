#!/bin/bash

# =====================================================
# SETUP PYTHON ENV PARA REUNIONES EN EC2
# =====================================================
# Instala dependencias Python para diarización + transcripción
# Ejecutar como: bash setup-meetings-python.sh

set -e

echo "🐍 [1/5] Instalando dependencias del sistema..."
sudo apt-get update
sudo apt-get install -y ffmpeg python3 python3-venv python3-pip

echo "📦 [2/5] Creando entorno virtual Python..."
sudo python3 -m venv /opt/meetings-venv
sudo chown -R ubuntu:ubuntu /opt/meetings-venv

echo "🔧 [3/5] Activando venv e instalando paquetes Python..."
source /opt/meetings-venv/bin/activate

pip install --upgrade pip setuptools wheel

# Instalar PyTorch (CPU only para EC2 sin GPU)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Instalar Pyannote para diarización
pip install pyannote.audio

# Instalar faster-whisper para transcripción
pip install faster-whisper

echo "✅ [4/5] Paquetes Python instalados:"
pip list | grep -E "torch|pyannote|whisper"

echo "⚠️  [5/5] CONFIGURAR HF_TOKEN"
echo ""
echo "OBLIGATORIO: Agregar HF_TOKEN a .env del proyecto:"
echo ""
echo "  HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
echo ""
echo "Obtener token en: https://huggingface.co/settings/tokens"
echo "Necesitas aceptar términos de uso de pyannote/speaker-diarization-3.1"
echo ""

echo "🎉 Setup completado. Python venv en: /opt/meetings-venv"
echo ""
echo "Para hacer chmod executable del script Python:"
echo "  chmod +x services/meetings/diarize_transcribe.py"
