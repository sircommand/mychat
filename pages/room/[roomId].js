import { useEffect, useRef, useState } from "react";

const SIGNALING_URL = "wss://accent-method-residence-elect.trycloudflare.com";

export default function RoomPage({ roomId }) {
  const localVideo = useRef(null);
  const remoteVideoRefs = [useRef(null), useRef(null)];
  const [streams, setStreams] = useState([null, null, null]);
  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState("");
  const wsRef = useRef(null);
  const [userId, setUserId] = useState(null);
  // peersInfo: { [peerId]: { pc, streamIndex } }
  const peersInfo = useRef({});

  useEffect(() => {
    let localStream;
    let myUserId;

    // Helper: find the first empty box [1] or [2] for remote
    function findEmptyRemoteIndex() {
      for (let i = 1; i <= 2; ++i)
        if (!streams[i]) return i;
      return null;
    }

    // Add remote track (video+audio)
    function addRemoteStream(peerId, stream) {
      setStreams(prev => {
        // Don't change local stream [0]
        const remoteIndex = findEmptyRemoteIndex();
        if (remoteIndex) {
          const newStreams = [...prev];
          newStreams[remoteIndex] = stream;
          // Assign streamIndex for this peer
          peersInfo.current[peerId].streamIndex = remoteIndex;
          return newStreams;
        }
        return prev;
      });
    }

    async function init() {
      // step1: get local cam
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStreams(s => [localStream, null, null]);
      if (localVideo.current) localVideo.current.srcObject = localStream;

      // step2: connect signaling server
      const ws = new window.WebSocket(SIGNALING_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "join_room", roomId }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.action === "peers") {
          if (!userId && wsRef.current && wsRef.current.url) {
            // Find yourself: when peers update, you are the one not present previously
            if (!myUserId) {
              // Try to find by elimination
              let others = Object.keys(peersInfo.current);
              myUserId = msg.peers.find(p => !others.includes(p));
              setUserId(myUserId);
            }
          }
          // Remove closed peers
          Object.keys(peersInfo.current).forEach(peerId => {
            if (!msg.peers.includes(peerId)) {
              if (peersInfo.current[peerId].pc) {
                peersInfo.current[peerId].pc.close();
              }
              setStreams(prev => {
                const ind = peersInfo.current[peerId].streamIndex || 1;
                const newStreams = [...prev];
                newStreams[ind] = null;
                return newStreams;
              });
              delete peersInfo.current[peerId];
            }
          });
          // Create PeerConnections for new peers
          msg.peers.forEach(peerId => {
            if (peerId !== myUserId && !peersInfo.current[peerId]) {
              // Make a new peer connection
              const pc = new RTCPeerConnection();
              // Send ICE candidates
              pc.onicecandidate = event => {
                if (event.candidate) {
                  ws.send(JSON.stringify({
                    action: "signal",
                    target: peerId,
                    from: myUserId,
                    type: "candidate",
                    candidate: event.candidate,
                  }));
                }
              };
              // Incoming streams
              pc.ontrack = (event) => {
                if (!peersInfo.current[peerId].stream) {
                  // new remote stream
                  peersInfo.current[peerId].stream = event.streams[0];
                  addRemoteStream(peerId, event.streams[0]);
                  if (peersInfo.current[peerId].streamIndex) {
                    // Update video element
                    if (remoteVideoRefs[peersInfo.current[peerId].streamIndex - 1].current)
                      remoteVideoRefs[peersInfo.current[peerId].streamIndex - 1].current.srcObject = event.streams[0];
                  }
                }
              };
              // لوکال ترک ها رو به هر peer connection attach کن
              localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
              peersInfo.current[peerId] = { pc };
              // Initiator: سمتی که userId بزرگتر داره، offer می‌سازد (جلوگیری از دو offer همزمان)
              if (!myUserId || (myUserId > peerId)) {
                pc.createOffer().then(offer => {
                  pc.setLocalDescription(offer);
                  ws.send(JSON.stringify({
                    action: "signal",
                    target: peerId,
                    from: myUserId,
                    type: "offer",
                    sdp: offer,
                  }));
                });
              }
            }
          });
        }
        else if (msg.action === "signal") {
          if (!myUserId) {
            myUserId = msg.target;
            setUserId(myUserId);
          }
          let peerId = msg.from;
          let isOfferer = false;
          if (!peersInfo.current[peerId]) {
            // Make RTCPeerConnection if not exist
            const pc = new RTCPeerConnection();
            pc.onicecandidate = event => {
              if (event.candidate) {
                ws.send(JSON.stringify({
                  action: "signal",
                  target: peerId,
                  from: myUserId,
                  type: "candidate",
                  candidate: event.candidate,
                }));
              }
            };
            pc.ontrack = (event) => {
              if (!peersInfo.current[peerId].stream) {
                peersInfo.current[peerId].stream = event.streams[0];
                addRemoteStream(peerId, event.streams[0]);
                if (peersInfo.current[peerId].streamIndex) {
                  if (remoteVideoRefs[peersInfo.current[peerId].streamIndex - 1].current)
                    remoteVideoRefs[peersInfo.current[peerId].streamIndex - 1].current.srcObject = event.streams[0];
                }
              }
            };
            // Attach local tracks
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
            peersInfo.current[peerId] = { pc };
            isOfferer = true;
          }
          const pc = peersInfo.current[peerId].pc;

          if (msg.type === "offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({
              action: "signal",
              target: peerId,
              from: myUserId,
              type: "answer",
              sdp: answer,
            }));
          }
          else if (msg.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          }
          else if (msg.type === "candidate" && msg.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (e) {}
          }
        }
        else if (msg.action === "force_leave") {
          alert("اتاق پر است");
          window.location = "/";
        }
        else if (msg.action === "chat") {
          setChat(old => [...old, { from: msg.from, text: msg.text }]);
        }
      };
    }

    init();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      Object.values(peersInfo.current).forEach(o => o.pc && o.pc.close());
    };
    // eslint-disable-next-line
  }, [roomId]);

  // When remote streams change, update refs
  useEffect(() => {
    for (let i = 1; i <= 2; ++i) {
      if (streams[i] && remoteVideoRefs[i-1].current)
        remoteVideoRefs[i-1].current.srcObject = streams[i];
    }
    // eslint-disable-next-line
  }, [streams]);

  return (
    <div style={{display: "flex", height: "100vh"}}>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
        {/* باکس تصویر کاربران */}
        <video ref={localVideo} autoPlay muted playsInline style={{width: "100%", maxWidth: 320, border: "2px solid green", margin: "10px"}} />
        <video ref={remoteVideoRefs[0]} autoPlay playsInline style={{width: "100%", maxWidth: 320, border: "2px solid red", margin: "10px"}} />
        <video ref={remoteVideoRefs[1]} autoPlay playsInline style={{width: "100%", maxWidth: 320, border: "2px solid blue", margin: "10px"}} />
      </div>
      <div style={{flex: 1, background: "#eee", display: 'flex', flexDirection: "column"}}>
        <h3>چت متنی</h3>
        <div style={{height: 400, overflowY: "auto", flex: 1}}>
          {chat.map((c, i) => <div key={i}><b>{c.from}: </b>{c.text}</div>)}
        </div>
        <div style={{display: "flex"}}>
          <input value={message} onChange={e=>setMessage(e.target.value)} style={{flex: 1}} />
          <button onClick={() => {
            if (wsRef.current && message) {
              wsRef.current.send(JSON.stringify({ action: "chat", text: message, from: userId }));
              setMessage("");
            }
          }}>ارسال</button>
        </div>
      </div>
    </div>
  )
}

RoomPage.getInitialProps = async ({ query }) => ({ roomId: query.roomId });