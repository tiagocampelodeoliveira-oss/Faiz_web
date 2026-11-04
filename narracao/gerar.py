"""Gera a narração da Íris (uma fala por cena do vídeo) em 3 vozes femininas de português do Brasil.
Roda no GitHub Actions (workflow "Voz da Íris"), que tem internet; o resultado volta para o ramo "voz".
"""
import asyncio, json, pathlib, subprocess
import edge_tts

aqui = pathlib.Path(__file__).parent
falas = json.loads((aqui / 'falas.json').read_text())
out = aqui / 'audio'

async def edge(voz, pasta, rate):
    (out / pasta).mkdir(parents=True, exist_ok=True)
    for i, t in enumerate(falas):
        await edge_tts.Communicate(t, voz, rate=rate, pitch='+4Hz').save(str(out / pasta / f'{i:02d}.mp3'))

asyncio.run(edge('pt-BR-ThalitaMultilingualNeural', 'thalita', '+6%'))
asyncio.run(edge('pt-BR-FranciscaNeural', 'francisca', '+8%'))

# Kokoro (licença Apache 2.0, roda local): voz pf_dora
try:
    import soundfile as sf
    from kokoro_onnx import Kokoro
    k = Kokoro(str(aqui / 'kokoro-v1.0.onnx'), str(aqui / 'voices-v1.0.bin'))
    (out / 'dora').mkdir(parents=True, exist_ok=True)
    for i, t in enumerate(falas):
        audio, sr = k.create(t, voice='pf_dora', speed=1.05, lang='pt-br')
        wav = out / 'dora' / f'{i:02d}.wav'
        sf.write(wav, audio, sr)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-b:a', '96k', str(wav.with_suffix('.mp3'))], check=True)
        wav.unlink()
except Exception as e:
    print('::warning::Kokoro falhou:', e)
for p in sorted(out.rglob('*.mp3')):
    print(p, p.stat().st_size)
