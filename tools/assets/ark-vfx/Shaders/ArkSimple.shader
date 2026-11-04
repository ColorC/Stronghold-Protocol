// Torappu/Particles/AlphaBlend and /Additive (and the ZDistort pair, whose vertex z-distortion only matters in the
// game's perspective camera): colour = channel(tex) * 2 * vertexColour * _TintColor, alpha saturated.
Shader "ArkVfx/Torappu/Simple"
{
    Properties
    {
        _TintColor ("Tint Color", Color) = (0.5,0.5,0.5,0.5)
        _MainTexChannel ("MainTex Channel", Float) = 0
        _MainTex ("Particle Texture", 2D) = "white" {}
        _ZTest ("ZTest", Float) = 4
        _ArkSrc ("src blend", Float) = 5
        _ArkDst ("dst blend", Float) = 10
        _ArkCull ("cull", Float) = 0
        _ArkZWrite ("zwrite", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" }
        Pass
        {
            Blend [_ArkSrc] [_ArkDst], Zero OneMinusSrcAlpha
            ZWrite [_ArkZWrite] ZTest [_ZTest] Cull [_ArkCull]
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "ArkTorappu.cginc"
            sampler2D _MainTex; float4 _MainTex_ST; half4 _TintColor; half _MainTexChannel;
            struct a2v { float4 vertex : POSITION; float4 uv : TEXCOORD0; half4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; half4 color : COLOR; };
            v2f vert(a2v v) { v2f o; o.pos = UnityObjectToClipPos(v.vertex); o.uv = TRANSFORM_TEX(v.uv.xy, _MainTex); o.color = v.color * _TintColor; return o; }
            half4 frag(v2f i) : SV_Target
            {
                half4 c = ArkChannel4(tex2D(_MainTex, i.uv), _MainTexChannel) * (i.color + i.color);
                c.a = saturate(c.a);
                return c;
            }
            ENDCG
        }
    }
}
