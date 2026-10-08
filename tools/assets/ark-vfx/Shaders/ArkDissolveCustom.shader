// Torappu/Particles/Dissolve/Dissolve(CustomData). With _HGCUSTOMVERTEXSTREAM_ON the particle custom streams drive:
// TEXCOORD0.zw = main uv offset, TEXCOORD1.xy = dissolve uv offset, TEXCOORD1.zw = (dissolve intensity, border width) offsets.
Shader "ArkVfx/Torappu/DissolveCustom"
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
        _CullMode ("Cull Mode", Float) = 0
        _UseDissolveTex ("Use Dissolve", Float) = 0
        _DissolvTexChannel ("DissolveTex Channel", Float) = 0
        _DissolveTex ("DissolveTex", 2D) = "white" {}
        _DissolveIntensity ("Dissolve Intensity", Range(0,1)) = 0.5
        _BorderWidth ("Border Width", Range(0.0001,1)) = 0.1
        _DissolveUSpeed ("Dissolve U Speed", Float) = 0
        _DissolveVSpeed ("Dissolve V Speed", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" }
        Pass
        {
            Blend SrcAlpha [_DstBlend], Zero OneMinusSrcAlpha
            ZWrite Off ZTest [_ZTest] Cull [_CullMode]
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_local __ _HGCUSTOMVERTEXSTREAM_ON
            #include "ArkTorappu.cginc"
            sampler2D _MainTex, _DissolveTex; float4 _MainTex_ST, _DissolveTex_ST;
            half4 _MainColor; half _MainTexChannel, _DissolvTexChannel, _Opacity, _UseDissolveTex, _DissolveIntensity, _BorderWidth;
            float _MainUSpeed, _MainVSpeed, _DissolveUSpeed, _DissolveVSpeed;
            struct a2v { float4 vertex : POSITION; float4 uv : TEXCOORD0; float4 uv1 : TEXCOORD1; half4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float4 uv : TEXCOORD0; half4 color : COLOR; float2 cd : TEXCOORD1; };
            v2f vert(a2v v)
            {
                v2f o; o.pos = UnityObjectToClipPos(v.vertex);
                float2 m = TRANSFORM_TEX(v.uv.xy, _MainTex), d = TRANSFORM_TEX(v.uv.xy, _DissolveTex);
                o.cd = 0;
                #ifdef _HGCUSTOMVERTEXSTREAM_ON
                m += v.uv.zw; d += v.uv1.xy; o.cd = v.uv1.zw;
                #endif
                o.uv = float4(_Time.y * float2(_MainUSpeed, _MainVSpeed) + m, _Time.y * float2(_DissolveUSpeed, _DissolveVSpeed) + d);
                o.color = half4(v.color.rgb * _MainColor.rgb, v.color.a);
                return o;
            }
            half4 frag(v2f i) : SV_Target
            {
                half width = saturate(_BorderWidth + i.cd.y);
                #ifndef _HGCUSTOMVERTEXSTREAM_ON
                width = _BorderWidth;
                #endif
                half edge = ArkDissolve(ArkChannel1(tex2D(_DissolveTex, i.uv.zw), _DissolvTexChannel), _DissolveIntensity + i.cd.x, width);
                half4 t = ArkChannel4(tex2D(_MainTex, i.uv.xy), _MainTexChannel);
                half a = t.a * _MainColor.a * i.color.a * _Opacity * 2;
                half3 rgb = t.rgb * i.color.rgb * 2;
                return half4(rgb, saturate(_UseDissolveTex * (edge * a - a) + a));
            }
            ENDCG
        }
    }
}
