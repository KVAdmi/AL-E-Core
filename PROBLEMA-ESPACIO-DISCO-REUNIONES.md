## ⚠️ PROBLEMA: ESPACIO EN DISCO INSUFICIENTE EN EC2

### Estado Actual
```bash
Filesystem       Size  Used Avail Use% Mounted on
/dev/root         19G   15G  3.8G  80% /
```

**Solo 3.8GB disponibles**, pero instalación completa de PyTorch + Pyannote requiere ~8-10GB.

---

## 🔧 SOLUCIONES

### OPCIÓN 1: Ampliar Disco EC2 (RECOMENDADO)

**Pasos en AWS Console:**

1. **EC2 Dashboard** → Seleccionar instancia `100.27.201.233`
2. **Storage** tab → Click en Volume ID
3. **Actions** → **Modify Volume**
4. **Size**: Cambiar de 20 GB a **40 GB**
5. **Modify** → Esperar 5-10 minutos

**Luego en SSH:**
```bash
# Redimensionar partición
sudo growpart /dev/nvme0n1 1
sudo resize2fs /dev/nvme0n1p1

# Verificar
df -h
```

**Una vez ampliado, ejecutar:**
```bash
cd AL-E-Core
bash setup-meetings-python.sh
```

---

### OPCIÓN 2: Usar Groq Whisper para Transcripción (SIN DIARIZACIÓN)

**Más ligero y funciona HOY**, pero sin identificar speakers.

**Script simplificado** (`services/meetings/transcribe_simple.py`):
```python
#!/usr/bin/env python3
import sys
import json
import subprocess

# Usa Groq API (mismo que voz)
# NO requiere pyannote, NO requiere GPU
# Solo devuelve texto completo sin speakers

def transcribe_with_groq(audio_path):
    # POST a /api/voice/stt interno
    # O usar groq SDK directo
    pass
```

**PRO:**
- Instalación instantánea
- Funciona sin GPU
- Usa mismo stack de voz

**CON:**
- No identifica speakers (todo como "SPEAKER_00")
- Front muestra transcripción lineal

---

### OPCIÓN 3: Procesar en Cloud Externo

**Usar servicio externo** para diarización:
- **Deepgram**: $0.0043/min con diarización
- **AssemblyAI**: $0.037/min con speaker labels
- **Rev.ai**: Pay-as-you-go

**Implementación:**
1. Upload audio a servicio
2. Webhook callback con resultado
3. Guardar en Supabase

---

## 📊 COMPARACIÓN

| Método | Espacio Disco | GPU | Costo | Speakers | Tiempo |
|--------|---------------|-----|-------|----------|--------|
| **Pyannote local** | ~10GB | Recomendado | $0 | Sí (N) | ~3-5min/30min |
| **Groq Whisper** | <100MB | No | ~$0.04/hr | No | ~30s/30min |
| **Deepgram API** | 0 | No | $0.13/30min | Sí (ilimitado) | ~1min/30min |

---

## ✅ RECOMENDACIÓN FINAL

**Para HOY funcionando:**
1. **Ampliar disco a 40GB** (takes 10 min)
2. **Ejecutar setup completo** con pyannote
3. **Deploy a producción**

**Si no puedes ampliar disco HOY:**
- Usar **Groq Whisper** (transcripción sin speakers)
- Front muestra todo como un solo speaker
- **Upgrade a diarización después**

---

## 🚀 SIGUIENTE PASO

**¿Qué prefieres?**

A) Ampliar disco EC2 + instalación completa (30 min total)

B) Implementar versión simple con Groq (funciona en 5 min, sin speakers)

C) Usar servicio externo tipo Deepgram (integración API)
