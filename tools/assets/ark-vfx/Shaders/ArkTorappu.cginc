// HLSL ports of the Torappu/Particles/* GLES3 programs shipped in Arknights' [uc]shaders.ab (2026-10-06 extraction).
// The exporter supplies simulation time explicitly; wall-clock editor time must not change a recording.
#ifndef ARK_TORAPPU_INCLUDED
#define ARK_TORAPPU_INCLUDED
#include "UnityCG.cginc"
float4 _ArkCaptureTime;
#define _Time _ArkCaptureTime

// _XxxTexChannel enum: 0 = RGBA, 1..4 = R/G/B/A broadcast to all four
inline half4 ArkChannel4(half4 t, half ch)
{
    half s = ch == 1 ? t.r : (ch == 2 ? t.g : (ch == 3 ? t.b : t.a));
    return ch == 0 ? t : half4(s, s, s, s);
}

// dissolve/disturb channel enum: 0..3 = R/G/B/A
inline half ArkChannel1(half4 t, half ch)
{
    return ch == 0 ? t.r : (ch == 1 ? t.g : (ch == 2 ? t.b : t.a));
}

// the shipped dissolve edge: saturate((d - amount + width * (1 - roundEven(amount + 0.5))) / width)
inline half ArkDissolve(half d, half amount, half width)
{
    half k = 1.0 - round(amount + 0.5);
    return saturate((d - amount + width * k) / width);
}

// _HG_UV_ROTATION: global switch set at runtime by the game (default off); the rotation rows rotate uv around 0.5
float _HG_UV_ROTATION;
float4 _Rotation0, _Rotation1, _Rotation2, _Rotation3;
inline float2 ArkRotUV(float2 uv, float4 r)
{
    float2 c = uv - 0.5;
    float2 o = float2(dot(c, r.xz), dot(c, r.yw)) + 0.5;
    return _HG_UV_ROTATION > 0.5 ? o : uv;
}
#endif
