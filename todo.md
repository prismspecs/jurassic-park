## to do

- capture video from actor phones

  - The character teleprompters run on participants phones. I would like for them to sometimes record the participants who will be looking at their phone. I have added "capture-camera" to the @scenes.json file for each character. At in: 1, out: 5 it should record the participant from 1 second to 5 seconds once the scene has begun (Action!). I also need a way for this video to be sent to the server. We can store it on recordings/phone-vids. Because it will later be cut into a longer video and the timecodes should correspond (as in if it records from 0:01 to 0:05 in the scene, it will be cut into that position) and we need a way to store this meta data. So in the records/phone-vids directory there should be a json file which stores this list of shots that includes the character, the scene, and the time in/out.

- update scenes.json

  - add camera movements
    - https://docs.google.com/presentation/d/1AfB2Eh2Di7RI5x7QjNFDiLoypyYsyMnt9xGKXs9W35s/edit
  - add ins and outs which will be used by editing module
    - these are also in the document. there are F and B and A (above) and U (underneath)
    - with Above and Underneath these are shot as a separate take
    - there is also a final separate take for each dinosaur

- it should launch a separate thread on Action! to record sound

- reset PTZ controls for camera when it loads so that the camera is centered

- introduce Microphone Controls which works like Camera controls where I can add an audio source...

- while recording it should use the scenes.json file to set pan tilt and zoom at the designated timings.

- remove unncessary things

- sometimes I get the FF message that the tab is causing my computer to slow down with the STOP button

## Scene Recording

play the scene

some sort of 3 - 2 - 1 action moment (this should be computerized so that it is synced rather than the actor)

actors get their teleprompter stuff

recording begins

camera uses the scene.json file to zoom, move, etc. (?)

recording ends

video files are sent to the editing module (to be developed)

## Editor

The editor should intake the video and audio from the Scene Recording. It should then use the scenes.json data ins and outs to cut the footage.

## Video Player

Simple video player functionality to play the intro video, etc.

This should also have the ability to use a camera source with facial recognition of the audience. The faces of the audience will be randomly inserted on top of the video at selected moments.

## Onboarding App

Add the response stuff
