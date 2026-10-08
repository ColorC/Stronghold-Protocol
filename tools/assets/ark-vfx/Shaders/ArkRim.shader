// Torappu/Particles/AlphaBlend(ZWrite) (rim optional via _UseRim, per pixel) and Rim Texture/Tint (Add) (rim per vertex,
// fades the mesh by 1 - N.V to the _RimPower). Object-space view vector, as in the shipped programs.
Shader "ArkVfx/Torappu/Rim"
{
    Properties
    {
        _TintColor ("Tint Color", Color) = (0.5,0.5,0.5,0.5)
        _MainTex ("Particle Texture", 2D) = "white" {}
        _UseRim ("Use Rim", Float) = 0
        _RimPower ("Rim Power", Float) = 1
        _RimCol ("Rim Color", Color) = (1,1,1,1)
        _ZTest ("ZTest", Float) = 4
        _ZWrite ("ZWrite", Float) = 0
        _CullMode ("Cull Mode", Float) = 0
        _ArkSrc ("src blend", Float) = 5
        _ArkDst ("dst blend", Float) = 10
        _ArkVertexRim ("rim per vertex (Rim Add)", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "IgnoreProjector"="True" "RenderType"="Transparent" }
        Pass
        {
            Blend [_ArkSrc] [_ArkDst], Zero OneMinusSrcAlpha
            ZWrite [_ZWrite] ZTest [_ZTest] Cull [_CullMode]
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "ArkTorappu.cginc"
            sampler2D _MainTex; float4 _MainTex_ST; half4 _TintColor, _RimCol; half _UseRim, _RimPower, _ArkVertexRim;
            struct a2v { float4 vertex : POSITION; float3 normal : NORMAL; float4 uv : TEXCOORD0; half4 color : COLOR; };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; half4 color : COLOR; float3 opos : TEXCOORD1; float3 n : TEXCOORD2; };
            v2f vert(a2v v)
            {
                v2f o; o.pos = UnityObjectToClipPos(v.vertex); o.uv = TRANSFORM_TEX(v.uv.xy, _MainTex);
                o.opos = v.vertex.xyz; o.n = v.normal; o.color = v.color * _TintColor;
                if (_ArkVertexRim > 0.5)
                {
                    float3 view = normalize(mul(unity_WorldToObject, float4(_WorldSpaceCameraPos, 1)).xyz - v.vertex.xyz);
                    half rim = pow(1 - saturate(dot(view, normalize(v.normal))), _RimPower);
                    o.color = rim * _TintColor; o.color.rgb *= v.color.rgb;
                }
                return o;
            }
            half4 frag(v2f i) : SV_Target
            {
                half4 c = tex2D(_MainTex, i.uv) * (i.color + i.color);
                if (_ArkVertexRim < 0.5 && _UseRim > 0)
                {
                    float3 view = normalize(mul(unity_WorldToObject, float4(_WorldSpaceCameraPos, 1)).xyz - i.opos);
                    half rim = pow(1 - saturate(dot(view, normalize(i.n))), _RimPower);
                    c.rgb += _RimCol.rgb * rim;
                }
                c.a = saturate(c.a);
                return c;
            }
            ENDCG
        }
    }
}
