// Torappu/Particles/Disturb/Disturb(CustomData) and Torappu/Particles/Ram/Disturb(CustomData) (ARK_RAM: a ramp texture
// multiplies the colour; Disturb uses a weight texture on the distortion instead). Custom streams as in DissolveCustom,
// plus TEXCOORD2.xy = disturb uv offset and TEXCOORD1.zw = (dissolve amount, disturb intensity) offsets.
Shader "ArkVfx/Torappu/DisturbCustom"
{
    Properties
    {
        _HGCustomVertexStream ("Use Custom Data", Float) = 0
        _MainTexChannel ("MainTex Channel", Float) = 0
        _MainColor ("MainCol", Color) = (0.5,0.5,0.5,0.5)
        _Opacity ("Opacity", Float) = 1
        _MainTex ("Maintex", 2D) = "white" {}
        _MainUSpeed ("Main U Speed", Float) = 0
        _MainVSpeed ("Main V Speed", Float) = 0
        _ZTest ("ZTest", Float) = 4
        _DstBlend ("Alpha Blend Mode", Float) = 1
        _PremultiplyAlpha ("Src blend (Ram)", Float) = 5
        _CullMode ("Cull Mode", Float) = 0
        _DissolvTexChannel ("DissolveTex Channel", Float) = 0
        _BorderWidth ("Border Width", Range(0.0001,1)) = 0.1
        _DissolveTex ("DissolveTex", 2D) = "white" {}
        _Amount ("Amount", Range(0,1)) = 0.5
        _DissolveUSpeed ("Dissolve U Speed", Float) = 0
        _DissolveVSpeed ("Dissolve V Speed", Float) = 0
        _WeightTex ("Weight Texture", 2D) = "white" {}
        _RamTexChannel ("RamTex Channel", Float) = 0
        _RamTex ("Ram Texture", 2D) = "white" {}
        _DisturbTexChannel ("DisturbTex Channel", Float) = 0
        _DisturbInfluenceDissolveUV ("Disturb influence Dissolve(UV)", Float) = 0
        _DisturbInfluenceMainUV ("Disturb influence Main(UV)", Float) = 1
        _DisturbTex ("Disturb Texture", 2D) = "black" {}
        _IntensityU ("Disturb Intensity U", Range(0,2)) = 0
        _IntensityV ("Disturb intensity V", Range(0,2)) = 0
        _DisturbUSpeed ("Disturb U Speed", Float) = 0
        _DisturbVSpeed ("Disturb V Speed", Float) = 0
        _ArkRam ("ram variant", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" }
        Pass
        {
            // Disturb: SrcAlpha [_DstBlend]; Ram: [_PremultiplyAlpha] [_DstBlend] (the stand-in sets _PremultiplyAlpha = 5 for Disturb)
            Blend [_PremultiplyAlpha] [_DstBlend], Zero OneMinusSrcAlpha
            ZWrite Off ZTest [_ZTest] Cull [_CullMode]
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_local __ _HGCUSTOMVERTEXSTREAM_ON
            #include "ArkTorappu.cginc"
            sampler2D _MainTex, _DissolveTex, _DisturbTex, _WeightTex, _RamTex;
            float4 _MainTex_ST, _DissolveTex_ST, _DisturbTex_ST, _WeightTex_ST, _RamTex_ST;
            half4 _MainColor; half _MainTexChannel, _DissolvTexChannel, _DisturbTexChannel, _RamTexChannel, _Opacity, _Amount, _BorderWidth;
            half _DisturbInfluenceDissolveUV, _DisturbInfluenceMainUV, _IntensityU, _IntensityV, _PremultiplyAlpha, _ArkRam;
            float _MainUSpeed, _MainVSpeed, _DissolveUSpeed, _DissolveVSpeed, _DisturbUSpeed, _DisturbVSpeed;
            struct a2v { float4 vertex : POSITION; float4 uv : TEXCOORD0; float4 uv1 : TEXCOORD1; float2 uv2 : TEXCOORD2; half4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float4 uv : TEXCOORD0; float4 uv1 : TEXCOORD1; float2 cd : TEXCOORD2; half4 color : COLOR; };
            v2f vert(a2v v)
            {
                v2f o; o.pos = UnityObjectToClipPos(v.vertex);
                float2 m = TRANSFORM_TEX(v.uv.xy, _MainTex), d = TRANSFORM_TEX(v.uv.xy, _DissolveTex), u = TRANSFORM_TEX(v.uv.xy, _DisturbTex);
                float2 w = _ArkRam > 0.5 ? TRANSFORM_TEX(v.uv.xy, _RamTex) : TRANSFORM_TEX(v.uv.xy, _WeightTex);
                o.cd = 0;
                #ifdef _HGCUSTOMVERTEXSTREAM_ON
                m += v.uv.zw; d += v.uv1.xy; u += v.uv2.xy; o.cd = v.uv1.zw;
                #endif
                o.uv = float4(frac(_Time.y * float2(_MainUSpeed, _MainVSpeed)) + ArkRotUV(m, _Rotation0), frac(_Time.y * float2(_DissolveUSpeed, _DissolveVSpeed)) + ArkRotUV(d, _Rotation1));
                o.uv1 = float4(ArkRotUV(w, _Rotation2), frac(_Time.y * float2(_DisturbUSpeed, _DisturbVSpeed)) + ArkRotUV(u, _Rotation3));
                o.color = v.color;
                return o;
            }
            half4 frag(v2f i) : SV_Target
            {
                half amount = i.cd.x + _Amount;
                half dist = ArkChannel1(tex2D(_DisturbTex, i.uv1.zw), _DisturbTexChannel);
                half2 off = (i.cd.yy + half2(_IntensityU, _IntensityV)) * dist;
                half4 c; half a;
                if (_ArkRam > 0.5)
                {
                    half4 ram = ArkChannel4(tex2D(_RamTex, i.uv1.xy), _RamTexChannel);
                    float2 muv = off * _DisturbInfluenceMainUV + i.uv.xy;
                    float2 duv = off * _DisturbInfluenceDissolveUV + i.uv.zw;
                    c = ram * ArkChannel4(tex2D(_MainTex, muv), _MainTexChannel) * _MainColor * i.color;
                    a = c.a * _Opacity * 2;
                    half edge = ArkDissolve(ArkChannel1(tex2D(_DissolveTex, duv), _DissolvTexChannel), amount, _BorderWidth);
                    half alpha = saturate(saturate(edge) * a);
                    half3 rgb = c.rgb * 2;
                    return _PremultiplyAlpha < 1.5 ? half4(alpha * rgb * 2, alpha) : half4(rgb, alpha);
                }
                half2 wgt = tex2D(_WeightTex, i.uv1.xy).xy;
                float2 muv = off * wgt + i.uv.xy;
                float2 duv = _DisturbInfluenceDissolveUV * (wgt * off) + i.uv.zw;
                c = ArkChannel4(tex2D(_MainTex, muv), _MainTexChannel) * _MainColor * i.color;
                a = c.a * _Opacity * 2;
                half edge = ArkDissolve(ArkChannel1(tex2D(_DissolveTex, duv), _DissolvTexChannel), amount, _BorderWidth);
                return half4(c.rgb * 2, saturate(edge * a));
            }
            ENDCG
        }
    }
}
