"""Browser-client compatibility: bytes produced by the TypeScript client
(apps/web/src/lib/voice/pipecatProtocol.ts) must be accepted by Pipecat's real
ProtobufFrameSerializer and RTVI models.

The hex literals were emitted by the TS encoder; the mirror-image test — TS
decoding bytes emitted by this serializer — lives in
apps/web/src/lib/voice/__tests__/pipecatProtocol.test.ts.
"""

from pipecat.frames.frames import InputAudioRawFrame, InputTransportMessageFrame
from pipecat.processors.frameworks.rtvi import models as RTVI
from pipecat.serializers.protobuf import ProtobufFrameSerializer

# encodeAudioFrame({audio: [1,0,2,0], sampleRate: 16000, numChannels: 1})
TS_AUDIO = "120b1a040100020020807d2801"

# encodeMessageFrame(JSON.stringify(clientReadyMessage("id-1")))
TS_CLIENT_READY = (
    "22a3010aa0017b226c6162656c223a22727476692d6169222c2274797065223a22636c69656e742d7265616479222c"
    "226964223a2269642d31222c2264617461223a7b2276657273696f6e223a22322e312e30222c2261626f7574223a7b"
    "226c696272617279223a226c6f61722d7765622d766f696365222c226c6962726172795f76657273696f6e223a2231"
    "2e302e30222c22706c6174666f726d223a22776562227d7d7d"
)


async def test_server_deserializes_browser_microphone_audio():
    frame = await ProtobufFrameSerializer().deserialize(bytes.fromhex(TS_AUDIO))
    assert isinstance(frame, InputAudioRawFrame)
    assert frame.audio == bytes([1, 0, 2, 0])
    assert frame.sample_rate == 16000
    assert frame.num_channels == 1


async def test_server_deserializes_the_browsers_rtvi_client_ready():
    frame = await ProtobufFrameSerializer().deserialize(bytes.fromhex(TS_CLIENT_READY))
    assert isinstance(frame, InputTransportMessageFrame)
    assert frame.message["type"] == "client-ready"
    assert frame.message["label"] == RTVI.MESSAGE_LABEL


async def test_client_ready_payload_satisfies_pipecats_own_model():
    frame = await ProtobufFrameSerializer().deserialize(bytes.fromhex(TS_CLIENT_READY))
    data = RTVI.ClientReadyData.model_validate(frame.message["data"])
    assert data.version == RTVI.PROTOCOL_VERSION
    assert data.about.library == "loar-web-voice"
