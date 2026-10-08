// Torappu/Particles/Disturb/Disturb Origin (and Disturb Anchor, same inputs): main uv pushed by _DisturTex.r * intensity,
// colour = tex * _MainColor * vertexColour * _MainColor.a * 2 (alpha included), blend [_SrcBlend] [_DstBlend].
Shader "ArkVfx/Torappu/DisturbOrigin"
{
    Properties
    {
        _MainTex ("Maintex", 2D) = "white" {}
        _DisturTex ("Disturb Tex", 2D) = "black" {}
        _MainColor ("MainCol", Color) = (0.5,0.5,0.5,0.5)
        _IntensityU ("Intensity U", Float) = 0
        _IntensityV ("Intensity V", Float) = 0
        _SrcBlend ("Src", Float) = 5
        _DstBlend ("Dst", Float) = 1
        _ZTest ("ZTest", Float) = 4
        _CullMode ("Cull Mode", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" }
        Pass
        {
            Blend [_SrcBlend] [_DstBlend], Zero OneMinusSrcAlpha
            ZWrite Off ZTest [_ZTest] Cull [_CullMode]
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "ArkTorappu.cginc"
            sampler2D _MainTex, _DisturTex; float4 _MainTex_ST, _DisturTex_ST; half4 _MainColor; half _IntensityU, _IntensityV;
            struct a2v { float4 vertex : POSITION; float4 uv : TEXCOORD0; half4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; half4 color : COLOR; };
            v2f vert(a2v v) { v2f o; o.pos = UnityObjectToClipPos(v.vertex); o.uv = v.uv.xy; o.color = v.color; return o; }
            half4 frag(v2f i) : SV_Target
            {
                half d = tex2D(_DisturTex, TRANSFORM_TEX(i.uv, _DisturTex)).r;
                float2 uv = d * float2(_IntensityU, _IntensityV) + i.uv;
                half4 c = tex2D(_MainTex, TRANSFORM_TEX(uv, _MainTex)) * _MainColor * i.color * _MainColor.a;
                return c + c;
            }
            ENDCG
        }
    }
}
