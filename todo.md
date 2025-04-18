## to do

- virtual camera stuff

  - ability to use multiple (2) cameras
  - create an abstraction for each camera
  - each camera should have a preview device and a preview video on the homeView which corresponds to this preview device
  - each camera should have a recording device dropdown so that I can use that for ffmpeg recording
  - each camera should have a PTZ commands dropdown so that I can select which device to send PTZ commands to

- actor telepromter reads no scene is loaded until the scene starts but it should refresh or whatever when it begins

- capture video from actor phones

- use skeletal tracking to cut actors out

## Action Flow

play the scene

some sort of 3 - 2 - 1 action moment (this should be computerized so that it is synced rather than the actor)

actors get their teleprompter stuff

recording begins

camera uses the scene.json file to zoom, move, etc. (?)

recording ends

video files are sent to the editing module (to be developed)

## Editor
