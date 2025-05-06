## to do

### Interface

+ I have 2 identical cameras. They are both showing up with exactly the same names in the dropdown menus. It would be nice to have some sort of device ID to distinguish them listed in the dropdowns.

### Functional

+ I want to shift everything to a new sort of rendering pipeline. The idea is to draw to a canvas which then provides the option of rendering that canvas to another screen (like via the teleprompter) and also the option of recording that canvas as a video. This way I can do things like live skeletal tracking, emotional analysis, etc. and display that to the audience live. I need certain things to be different between the "teleprompter canvas" and the recording pipeline. Perhaps some things are applied before it gets shipped to the recording mechanism and then some things after. This is important because I want the option to do live skeletal masking (using the skeletal or pose tracking data and using it as a mask to "cut out" multiple human bodies to a transparent background video) which is saved in the generated video file.
+ Each camera has its own canvas. There is some optional processing which takes place such as drawing the skeleton from the pose estimator on top of the image, and using the bounding box from the detected body to create a mask which is then "cut out" from the total video. I would like to "record" that canvas to a video file, but only with certain effects applied (such as the crop feature). I would also like to be able to then display that canvas via the /teleprompter, but also with certain options (if it is possible) as in, only with skeletal rendering on top. I should be able to "forward" either the front or the back camera to the teleprompter at the click of a button.
+ Right now what is working is that one webcam (the first one) is rendering to a canvas in the middle panel, with optional Pose FX enabled. I can also save this video, which works well.


+ I have created a module in modules/dinosaur-game. It takes webcam input, does some processing and analysis, then outputs a new video. Right now that is working on its own, as in I can host a live server from that module directory via npm start and see the result in my browser. What I want to do with it ultimately is to use dinosaur-game as a module. If I start a shot which is of type "dinosaur" (in scenes.json) then the webcam should send video/frames to that module, and then it should receive back video/frames. For now it should use Camera 1 preview device as the input, and it should output/show the video in the center column.

- 3,2,1 count down before recording, after Action (this will be a video played on all teleprompters)

- The third time the scene is run, the audience hums along

- capture video from actor phones

  - The character teleprompters run on participants phones. I would like for them to sometimes record the participants who will be looking at their phone. I have added "capture-camera" to the @scenes.json file for each character. At in: 1, out: 5 it should record the participant from 1 second to 5 seconds once the scene has begun (Action!). I also need a way for this video to be sent to the server. We can store it on recordings/phone-vids. Because it will later be cut into a longer video and the timecodes should correspond (as in if it records from 0:01 to 0:05 in the scene, it will be cut into that position) and we need a way to store this meta data. So in the records/phone-vids directory there should be a json file which stores this list of shots that includes the character, the scene, and the time in/out.

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
