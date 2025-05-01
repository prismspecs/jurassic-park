## to do

### Interface

+ I have 2 identical cameras. They are both showing up with exactly the same names in the dropdown menus. It would be nice to have some sort of device ID to distinguish them listed in the dropdowns.

+ When Johannes tried to access my server from IP:3000/ it said it was not a safe connection. How can we deal with that?

- When hovering over an element, press F to fullscreen that particular element. ??

### Functional


- 3,2,1 count down before recording, after Action (this will be a video played on all teleprompters)

- The third time the scene is run, the audience hums along

- Dinosaur position accuracy: how well can they take up the shape/outline of the dinosaur while they are acting as one?

- capture video from actor phones

  - The character teleprompters run on participants phones. I would like for them to sometimes record the participants who will be looking at their phone. I have added "capture-camera" to the @scenes.json file for each character. At in: 1, out: 5 it should record the participant from 1 second to 5 seconds once the scene has begun (Action!). I also need a way for this video to be sent to the server. We can store it on recordings/phone-vids. Because it will later be cut into a longer video and the timecodes should correspond (as in if it records from 0:01 to 0:05 in the scene, it will be cut into that position) and we need a way to store this meta data. So in the records/phone-vids directory there should be a json file which stores this list of shots that includes the character, the scene, and the time in/out.

- update scenes.json

  - add camera movements
    - https://docs.google.com/presentation/d/1AfB2Eh2Di7RI5x7QjNFDiLoypyYsyMnt9xGKXs9W35s/edit
  - add ins and outs which will be used by editing module
    - these are also in the document. there are F and B and A (above) and U (underneath)
    - with Above and Underneath these are shot as a separate take
    - there is also a final separate take for each dinosaur

- refactor the endpoints. some use /api/ prefix. /camera/ does not, for example. I should update everything to use /api/

- remove unncessary things

- sometimes I get the FF message that the tab is causing my computer to slow down with the STOP button

- "live" view from AI Brain including skeletal tracking

- right now I can run this command to combine the audio and video
  ffmpeg -i Camera*1/*.mp4 -i Audio*1/*.wav -c:v copy -map 0:v:0 -map 1:a:0 -shortest combined.mp4

## Editor

The editor should intake the video and audio from the Scene Recording. It should then use the scenes.json data ins and outs to cut the footage.

## Video Player

Simple video player functionality to play the intro video, etc.

This should also have the ability to use a camera source with facial recognition of the audience. The faces of the audience will be randomly inserted on top of the video at selected moments.

## Onboarding App

Add the response stuff
https://docs.google.com/document/d/1Kx4YZ3arvCnaE2Umt2WNsGctx1xCvtSGD1VTiV_tzBQ/edit?tab=t.0

Personality test...?

## Post-onboarding

Flash all the participants on the screen with their names. The AI voice actor will voice this over.
I guess this means I will need to create a way to create "batches" of participants
