// Source: Torappu/Particles-L2D/Dissolve/Dissolve(CustomData), shipped GLES3 programs.
// L2D wraps UV velocity with frac and uses its authored destination blend for the alpha channel too.
Shader "ArkVfx/Torappu/L2DDissolveCustom"
{
    Properties
    {
        _HGCustomVertexStream ("Use Custom Data", Float) = 0
        _MainColor ("Main Color", Color) = (0.5,0.5,0.5,0.5)
        _Opacity ("Opacity", Float) = 1
        _MainTexChannel ("MainTex Channel", Float) = 0
        _MainTex ("Particle Texture", 2D) = "white" {}
        _MainUSpeed ("Main U Speed", Float) = 0
        _MainVSpeed ("Main V Speed", Float) = 0
        _ZTest ("ZTest", Float) = 4
        _DstBlend ("Alpha Blend Mode", Float) = 1
        _CullMode ("Cull Mode", Float) = 0
        _UseDissolveTex ("Use Dissolve Texture", Float) = 0
        _DissolvTexChannel ("DissolveTex Channel", Float) = 0
        _DissolveTex ("Dissolve Texture", 2D) = "black" {}
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
            Blend SrcAlpha [_DstBlend], Zero [_DstBlend]
            ZWrite Off ZTest [_ZTest] Cull [_CullMode]
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_local __ _HGCUSTOMVERTEXSTREAM_ON
            #include "ArkTorappu.cginc"
            sampler2D _MainTex, _DissolveTex;
            float4 _MainTex_ST, _DissolveTex_ST;
            half4 _MainColor;
            half _MainTexChannel, _DissolvTexChannel, _Opacity, _UseDissolveTex, _DissolveIntensity, _BorderWidth;
            float _MainUSpeed, _MainVSpeed, _DissolveUSpeed, _DissolveVSpeed;
            struct a2v { float4 vertex : POSITION; float4 uv : TEXCOORD0; float4 uv1 : TEXCOORD1; half4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float4 uv : TEXCOORD0; half4 color : COLOR; float2 cd : TEXCOORD1; };
            v2f vert(a2v v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                float2 main = TRANSFORM_TEX(v.uv.xy, _MainTex);
                float2 dissolve = TRANSFORM_TEX(v.uv.xy, _DissolveTex);
                o.cd = 0;
                #ifdef _HGCUSTOMVERTEXSTREAM_ON
                main += v.uv.zw;
                dissolve += v.uv1.xy;
                o.cd = v.uv1.zw;
                #endif
                o.uv = float4(main + frac(_Time.y * float2(_MainUSpeed, _MainVSpeed)),
                              dissolve + frac(_Time.y * float2(_DissolveUSpeed, _DissolveVSpeed)));
                o.color = half4(v.color.rgb * _MainColor.rgb, v.color.a);
                return o;
            }
            half4 frag(v2f i) : SV_Target
            {
                half width = _BorderWidth;
                #ifdef _HGCUSTOMVERTEXSTREAM_ON
                width = saturate(width + i.cd.y);
                #endif
                half edge = ArkDissolve(ArkChannel1(tex2D(_DissolveTex, i.uv.zw), _DissolvTexChannel),
                                        _DissolveIntensity + i.cd.x, width);
                half4 t = ArkChannel4(tex2D(_MainTex, i.uv.xy), _MainTexChannel);
                half alpha = 2 * t.a * _MainColor.a * i.color.a * _Opacity;
                return half4(2 * t.rgb * i.color.rgb, saturate(alpha + _UseDissolveTex * (edge * alpha - alpha)));
            }
            ENDCG
        }
    }
}
