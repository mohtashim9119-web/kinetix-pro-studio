# WS1 Session AL — v6 arm D chunk inspection table (MEASURED)

Period-strict planner, band **1-15s** (OPERATOR-DIRECTED), silence
search window **±5s** (OPERATOR-DIRECTED, inherited unchanged from
`S2_SILENCE_SEARCH_WINDOW_SEC`), R.5 excision ON. v6 = 1421.29s, 447 segments.

Total chunks: **110**. Every chunk is listed; nothing is elided.

`cut` column: `detected-silence` = the audio cut landed on a detected silence end within the
search window; `geometric-fallback` = no silence inside the window, cut taken at the geometric
midpoint of the inter-word gap; `excision-run-edge` = the cut is an R.5 run boundary;
`corpus-end` = the final chunk ends at `audioDuration`. `Δideal` is the committed cut minus the
estimate-based ideal seam.

| # | start | end | dur | cut | Δideal | sents | segs | >cap | ending text |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 3.570 | 17.880 | 14.310 | detected-silence | +0.033 | 6 | 0-5 |  | her is asleep against the far wall. It is deep in the night. You are wide awake. |
| 1 | 17.880 | 32.740 | 14.860 | detected-silence | +1.402 | 5 | 6-12 |  | is the only reason you are not screaming. The sound stops. The night goes quiet. |
| 2 | 32.740 | 46.460 | 13.720 | detected-silence | +0.367 | 5 | 13-17 |  | head. That stillness tells you something. She has been listening the whole time. |
| 3 | 46.460 | 57.100 | 10.640 | detected-silence | +1.310 | 3 | 18-20 |  |  word being spoken. The darkness past the firelight is not empty. It has weight. |
| 4 | 57.100 | 68.580 | 11.480 | detected-silence | +0.071 | 3 | 21-24 |  |  side one hand on the warm stones ringing the hearth. You dream about the sound. |
| 5 | 68.580 | 81.260 | 12.680 | detected-silence | +0.034 | 4 | 25-28 |  |  in you. Small and permanent. A new understanding of what the night actually is. |
| 6 | 81.260 | 98.300 | 17.040 | detected-silence | +2.319 | 5 | 29-33 | **YES** | elves around the fire before full dark. Nobody told them to do it. They just do. |
| 7 | 98.300 | 108.920 | 10.620 | detected-silence | +0.782 | 4 | 34-37 |  | Certain men sleep closest to the fire’s edge. The arrangement is not accidental. |
| 8 | 108.920 | 125.250 | 16.330 | excision-run-edge | +4.323 | 3 | 38-40 | **YES** |  position in that shape. But you are old enough to start learning what it means. |
| 9 | 129.150 | 134.240 | 5.090 | detected-silence | +0.033 | 3 | 41-46 |  | d fat-soaked moss bound with sinew held in both hands out in front of your body. |
| 10 | 134.240 | 146.620 | 12.380 | detected-silence | -0.586 | 3 | 47-50 |  | ers move ahead. You stay in the center column with the women and older children. |
| 11 | 146.620 | 162.480 | 15.860 | detected-silence | +2.275 | 3 | 51-54 | **YES** | . They do not speak on night marches. Their silence is a tool same as the spear. |
| 12 | 162.480 | 174.240 | 11.760 | detected-silence | -0.721 | 2 | 55-56 |  | ound and sputters and for three full heartbeats the column loses half its light. |
| 13 | 174.240 | 189.560 | 15.320 | detected-silence | -0.368 | 6 | 57-63 | **YES** | holds it until you have the torch burning again from the second carrier’s coals. |
| 14 | 189.560 | 205.080 | 15.520 | detected-silence | +0.397 | 5 | 64-69 | **YES** |  You are expected to understand that on your own. You do not drop a torch again. |
| 15 | 205.080 | 216.540 | 11.460 | detected-silence | -0.300 | 4 | 70-73 |  | animal going silent at once is not. Wind through pine moves without any pattern. |
| 16 | 216.540 | 232.200 | 15.660 | detected-silence | +0.394 | 5 | 74-79 | **YES** | e it change. When the lead hunter slows every person slows. No signal. No sound. |
| 17 | 232.200 | 249.500 | 17.300 | excision-run-edge | +5.679 | 4 | 80-83 | **YES** |  even at camp. You did not decide to. Your body made that choice without asking. |
| 18 | 253.320 | 261.620 | 8.300 | detected-silence | -0.540 | 4 | 84-88 |  | h and wet sinew that dried hard as rock. They start sending you on forward runs. |
| 19 | 261.620 | 274.620 | 13.000 | detected-silence | -0.399 | 4 | 89-93 |  | move ahead of the main group by about the distance a man can shout and be heard. |
| 20 | 274.620 | 287.860 | 13.240 | detected-silence | +1.106 | 3 | 94-96 |  | ore you look. A predator’s presence reaches your nose before your mind names it. |
| 21 | 287.860 | 299.080 | 11.220 | detected-silence | +1.083 | 4 | 97-100 |  | ur third run and stop walking. Korik stops half a step after you. He has it too. |
| 22 | 299.080 | 313.800 | 14.720 | detected-silence | +1.469 | 3 | 101-104 |  |  water runs in reverse. Slow, continuous, nothing sudden enough to announce you. |
| 23 | 313.800 | 325.820 | 12.020 | detected-silence | +0.210 | 3 | 105-108 |  | from where you stood. The print is wider than both your hands laid side by side. |
| 24 | 325.820 | 338.760 | 12.940 | detected-silence | +0.291 | 7 | 109-115 |  | anything. See, register, return. A scout who sees too little endangers the band. |
| 25 | 338.760 | 352.400 | 13.640 | detected-silence | +0.650 | 4 | 116-120 |  | e not yet calm about it. Your voice holds when you report but your hands do not. |
| 26 | 352.400 | 369.750 | 17.350 | excision-run-edge | +11.535 | 3 | 121-123 | **YES** | your hands when you speak. You see him doing it. You start working on the hands. |
| 27 | 373.490 | 375.200 | 1.710 | detected-silence | -0.230 | 3 | 124-127 |  | ck to the fire so your eyes can adjust fully to the dark beyond the camp’s edge. |
| 28 | 375.200 | 389.920 | 14.720 | detected-silence | +2.474 | 4 | 128-133 |  | int. It keeps you from drifting. You guard your stretch wake the next man sleep. |
| 29 | 389.920 | 394.640 | 4.720 | detected-silence | +1.151 | 2 | 134-136 |  | urs at most before you are back up. This runs every night no matter the weather. |
| 30 | 394.640 | 408.100 | 13.460 | detected-silence | -0.145 | 2 | 137-139 |  | g. The body does not wait for the mind to decide if a sound is worth waking for. |
| 31 | 408.100 | 421.840 | 13.740 | detected-silence | +2.001 | 7 | 140-147 |  | he fire settling. Branches pulling tight in the cold. Sleeping people breathing. |
| 32 | 421.840 | 432.980 | 11.140 | detected-silence | -0.631 | 3 | 148-150 |  | ot. You are not listening for a sound. You are listening for the absence of one. |
| 33 | 432.980 | 445.840 | 12.860 | detected-silence | -1.051 | 3 | 151-155 |  | something passed under them. These gaps tell you more than any loud noise could. |
| 34 | 445.840 | 460.560 | 14.720 | detected-silence | -1.298 | 4 | 156-159 |  | camp stands up and it takes several minutes to settle. Nobody is angry with you. |
| 35 | 460.560 | 471.260 | 10.700 | detected-silence | -1.489 | 2 | 160-163 |  |  you do not want to carry that feeling again. The second time you wait too long. |
| 36 | 471.260 | 484.840 | 13.580 | detected-silence | +0.075 | 2 | 164-166 |  |  wolf testing the perimeter drawn by the smell of the previous day’s butchering. |
| 37 | 484.840 | 498.520 | 13.680 | detected-silence | +1.318 | 3 | 167-170 |  | u at your post afterward. He tells you one thing and you never stop carrying it. |
| 38 | 498.520 | 521.250 | 22.730 | excision-run-edge | +13.859 | 3 | 171-174 | **YES** | pattern has broken that is enough. Stop waiting for your mind to finish arguing. |
| 39 | 525.820 | 536.040 | 10.220 | detected-silence | -1.427 | 4 | 175-186 |  | her is Yaro thirty years old the most composed man on any hunt you have been on. |
| 40 | 536.040 | 550.360 | 14.320 | detected-silence | -0.107 | 5 | 187-191 |  | ahead of you into the dark. Yaro signals to stop. You both go still. You listen. |
| 41 | 550.360 | 564.180 | 13.820 | detected-silence | -0.761 | 6 | 192-197 |  | ocate it in the trees. You do not move. Yaro does not move. The breathing stops. |
| 42 | 564.180 | 571.360 | 7.180 | detected-silence | +0.024 | 2 | 198-201 |  |  Then Yaro shifts his weight back one foot at a time and you mirror him exactly. |
| 43 | 571.360 | 586.500 | 15.140 | detected-silence | +1.182 | 2 | 202-205 | **YES** | ne. You reach the open meadow and you both run not deciding to run just running. |
| 44 | 586.500 | 596.400 | 9.900 | detected-silence | -0.583 | 4 | 206-209 |  | he aurochs are gone. Whatever shared that timber with you was not worth finding. |
| 45 | 596.400 | 609.080 | 12.680 | detected-silence | -0.481 | 3 | 210-212 |  | e dark assessed you and made a decision. You do not know what it decided or why. |
| 46 | 609.080 | 623.940 | 14.860 | detected-silence | +0.256 | 4 | 213-216 |  |  you were taught. It does not sit in the same place. You get quieter after that. |
| 47 | 623.940 | 630.620 | 6.680 | detected-silence | +0.331 | 2 | 217-218 |  |  rearranged inside. You understand that surviving is not only about what you do. |
| 48 | 630.620 | 663.630 | 33.010 | excision-run-edge | +19.359 | 3 | 219-222 | **YES** | l removes entirely. You do not say this to anyone for a long time. You carry it. |
| 49 | 666.610 | 671.480 | 4.870 | detected-silence | -1.180 | 5 | 223-235 |  | ey give anyone else. You did not ask for this. You are not sure when it started. |
| 50 | 671.480 | 684.440 | 12.960 | detected-silence | -0.235 | 5 | 236-240 |  | own body. This sits differently. It is about theirs. Your youngest scout is Fen. |
| 51 | 684.440 | 697.540 | 13.100 | detected-silence | +0.639 | 4 | 241-244 |  | h him for two full seasons and say almost nothing. You let him see the contrast. |
| 52 | 697.540 | 709.160 | 11.620 | detected-silence | -0.389 | 3 | 245-248 |  | ut being harder to detect. Fast is for after the decision has already been made. |
| 53 | 709.160 | 722.240 | 13.080 | detected-silence | +0.112 | 5 | 249-254 |  | u can see it. You remember Daret’s hand on your shoulder over the dropped torch. |
| 54 | 722.240 | 736.060 | 13.820 | detected-silence | +0.511 | 2 | 255-257 |  | t something real. The things that kept you alive were not only your own choices. |
| 55 | 736.060 | 748.000 | 11.940 | detected-silence | +0.225 | 3 | 258-260 |  | ss to try. You try to build that same room for Fen. You do not always manage it. |
| 56 | 748.000 | 759.760 | 11.760 | detected-silence | -0.241 | 2 | 261-262 |  |  time you are sitting at the fire watching their faces. Every dawn is temporary. |
| 57 | 759.760 | 787.850 | 28.090 | excision-run-edge | +21.455 | 1 | 263-264 | **YES** | es back the same way your mother fed the fire without announcement, without end. |
| 58 | 791.940 | 794.920 | 2.980 | detected-silence | -1.760 | 2 | 265-270 |  | meat and understand you have become something this group has no simple word for. |
| 59 | 794.920 | 812.880 | 17.960 | detected-silence | +1.515 | 5 | 271-275 | **YES** | s on cold mornings before you are fully awake. You are not old by some measures. |
| 60 | 812.880 | 822.920 | 10.040 | detected-silence | +1.085 | 4 | 276-279 |  | y old. There are faster men now. There are scouts with sharper ears. You say so. |
| 61 | 822.920 | 833.600 | 10.680 | detected-silence | -0.813 | 3 | 280-284 |  | n the birch stands. He takes it as modesty at first. You explain that it is not. |
| 62 | 833.600 | 842.520 | 8.920 | detected-silence | -0.676 | 1 | 285-287 |  | t correctly means his responsibility at night is larger than it was not smaller. |
| 63 | 842.520 | 856.860 | 14.340 | detected-silence | -1.091 | 3 | 288-290 |  | reach the site. The child is barely four years old. You are at the eastern post. |
| 64 | 856.860 | 873.360 | 16.500 | detected-silence | +2.199 | 5 | 291-295 | **YES** | ery decision of that night. The positioning was right. The rotations were right. |
| 65 | 873.360 | 875.700 | 2.340 | detected-silence | -0.661 | 2 | 296-297 |  | The arrangement was what it has always been. None of that lifts the weight. |
| 66 | 875.700 | 888.560 | 12.860 | detected-silence | +0.394 | 1 | 298-299 |  | erience allow and the night will still find the gap that structure cannot close. |
| 67 | 888.560 | 901.120 | 12.560 | detected-silence | -1.802 | 4 | 300-303 |  | in open ground. You rebuild. You add a post that covers the gap the night found. |
| 68 | 901.120 | 924.500 | 23.380 | excision-run-edge | +15.254 | 2 | 304-305 | **YES** | put down the grief. You carry it alongside everything else and you keep working. |
| 69 | 929.330 | 936.440 | 7.110 | detected-silence | +1.688 | 1 | 306-310 |  | alk that only happens between people who have shared a particular kind of night. |
| 70 | 936.440 | 951.640 | 15.200 | detected-silence | +2.554 | 4 | 311-314 | **YES** | u understand what he is asking. You watch the two of them over several evenings. |
| 71 | 951.640 | 959.320 | 7.680 | detected-silence | +0.467 | 3 | 315-318 |  | t combination you know. The fear itself is not the problem. Fear is information. |
| 72 | 959.320 | 964.720 | 5.400 | detected-silence | -1.300 | 1 | 319-319 |  | ppens when the body’s warning triggers a second signal that overrides the first. |
| 73 | 964.720 | 975.660 | 10.940 | detected-silence | -0.971 | 2 | 320-321 |  | e a hard night is not a sign of weakness arriving. It is the body getting ready. |
| 74 | 975.660 | 987.120 | 11.460 | detected-silence | +0.793 | 3 | 322-324 |  |  still works. You see it take in his face. The other one is nearly the opposite. |
| 75 | 987.120 | 1000.320 | 13.200 | detected-silence | -0.903 | 2 | 325-326 |  | rimeter edge one evening and ask her to stand still and report what she notices. |
| 76 | 1000.320 | 1016.320 | 16.000 | detected-silence | +0.341 | 7 | 327-333 | **YES** | y registered until it was gone. You tell her that. That second kind of noticing. |
| 77 | 1016.320 | 1029.040 | 12.720 | detected-silence | -0.079 | 4 | 334-337 |  | t certain Daret and Korik gave you everything you needed. You gave what you had. |
| 78 | 1029.040 | 1044.470 | 15.430 | excision-run-edge | +11.276 | 1 | 338-338 | **YES** | The rest belongs to the nights they will face without you. |
| 79 | 1050.080 | 1054.740 | 4.660 | detected-silence | +1.029 | 5 | 339-344 |  |  them. The white line across your left palm from a night in the limestone hills. |
| 80 | 1054.740 | 1068.840 | 14.100 | detected-silence | +1.848 | 3 | 345-347 |  | om four decades of gripping things hard in the cold. Other bands know your name. |
| 81 | 1068.840 | 1078.180 | 9.340 | detected-silence | +0.437 | 3 | 348-351 |  | nown or a reliable river crossing. A feature of the world that people orient by. |
| 82 | 1078.180 | 1092.340 | 14.160 | detected-silence | +0.614 | 1 | 352-355 |  | gainst one that only crossed your path people look toward where you are sitting. |
| 83 | 1092.340 | 1103.940 | 11.600 | detected-silence | +1.182 | 2 | 356-357 |  | me has attached to a kind of knowledge people understand is not easily replaced. |
| 84 | 1103.940 | 1117.440 | 13.500 | detected-silence | +1.824 | 4 | 358-361 |  | aw when you first looked at Daret. Proof that surviving a long time is possible. |
| 85 | 1117.440 | 1131.220 | 13.780 | detected-silence | +0.708 | 3 | 362-365 |  | ost same as you always do. You tell them the calm they see was not always there. |
| 86 | 1131.220 | 1144.700 | 13.480 | detected-silence | -0.287 | 2 | 366-369 |  | the nights you got it right only because something in the dark chose to let you. |
| 87 | 1144.700 | 1156.480 | 11.780 | detected-silence | -0.172 | 6 | 370-375 |  | d. They do not take in the losses the same way. They are not ready for them yet. |
| 88 | 1156.480 | 1168.180 | 11.700 | detected-silence | +1.269 | 1 | 376-378 |  | lse’s fire at their age being told the whole truth and only catching part of it. |
| 89 | 1168.180 | 1188.050 | 19.870 | excision-run-edge | +6.805 | 3 | 379-381 | **YES** | you can do is be honest and let them take what they are able to carry right now. |
| 90 | 1192.330 | 1196.640 | 4.310 | detected-silence | +0.218 | 4 | 382-385 |  | that forward scouting demands. You know this without needing anyone to tell you. |
| 91 | 1196.640 | 1209.400 | 12.760 | detected-silence | -1.145 | 2 | 386-388 |  | ones teaching the people after them. What you do now is harder to put a name to. |
| 92 | 1209.400 | 1223.880 | 14.480 | detected-silence | +2.162 | 2 | 389-390 |  | n the valley and the cold has pulled everything close. Children gather near you. |
| 93 | 1223.880 | 1235.820 | 11.940 | detected-silence | +0.821 | 3 | 391-393 |  | dark hours. You are not telling stories to fill time. You are passing something. |
| 94 | 1235.820 | 1245.780 | 9.960 | detected-silence | -1.305 | 2 | 394-395 |  |  three seconds in the forest with Yaro when something in the dark made a choice. |
| 95 | 1245.780 | 1256.240 | 10.460 | detected-silence | -0.402 | 1 | 396-397 |  | d in the weeks after and why you did not let that weight take the work from you. |
| 96 | 1256.240 | 1267.340 | 11.100 | detected-silence | -0.545 | 2 | 398-399 |  | ence he could feel in his whole body. You tell them the dark cannot be finished. |
| 97 | 1267.340 | 1277.600 | 10.260 | detected-silence | -0.264 | 1 | 400-402 |  | ts the same quality of attention on the thousandth night as it did on the first. |
| 98 | 1277.600 | 1285.440 | 7.840 | detected-silence | +1.393 | 1 | 403-403 |  |  them the fire is the line and they are the ones responsible for keeping it fed. |
| 99 | 1285.440 | 1296.640 | 11.200 | detected-silence | -1.812 | 2 | 404-406 |  |  way you have listened to it for fifty years. You still catch the interruptions. |
| 100 | 1296.640 | 1304.340 | 7.700 | detected-silence | -1.138 | 2 | 407-408 |  | he air outside the camp shifts in a certain way. The knowledge has not left you. |
| 101 | 1304.340 | 1314.460 | 10.120 | detected-silence | -0.434 | 1 | 409-410 |  | es to when it stops being something you do and becomes something you simply are. |
| 102 | 1314.460 | 1329.660 | 15.200 | detected-silence | -0.061 | 4 | 411-417 | **YES** | locked. Weight even. Eyes moving in a slow sweep rather than fixed on one point. |
| 103 | 1329.660 | 1340.720 | 11.060 | detected-silence | +0.460 | 4 | 418-421 |  | making a sound. She does not know you are watching. She is entirely in her work. |
| 104 | 1340.720 | 1355.880 | 15.160 | detected-silence | -0.471 | 1 | 422-423 | **YES** | ther watching body repeated across more generations than anyone alive can count. |
| 105 | 1355.880 | 1371.500 | 15.620 | detected-silence | +0.392 | 3 | 424-429 | **YES** | iving night after night along the line where firelight ends and the dark begins. |
| 106 | 1371.500 | 1384.620 | 13.120 | detected-silence | -0.049 | 5 | 430-434 |  | ord for what they feel. The tightness in the chest. The sudden, total attention. |
| 107 | 1384.620 | 1398.160 | 13.540 | detected-silence | +0.280 | 4 | 435-439 |  | learn. They will learn what the sounds mean. They will learn to slow their feet. |
| 108 | 1398.160 | 1410.720 | 12.560 | detected-silence | +0.403 | 2 | 440-441 |  |  will carry a torch in both hands and guard it with their body against the wind. |
| 109 | 1410.720 | 1421.290 | 10.570 | corpus-end | +0.000 | 5 | 442-446 |  |  They always will. The dark does not change. Only the ones who learn to face it. |

## Distribution

- n **110** | min **1.71s** | p25 10.64s | **median 12.86s** | p75 14.48s | max **33.01s** | mean 12.545s
- chunks under 1s: **0** | chunks over 15s: **22**

| bucket | count |
|---|---|
| 0-1s | 0 |
| 1-2s | 1 |
| 2-4s | 2 |
| 4-6s | 6 |
| 6-8s | 6 |
| 8-10s | 5 |
| 10-12s | 27 |
| 12-14s | 30 |
| 14-15s | 11 |
| 15-20s | 18 |
| 20-30s | 3 |
| 30-45s | 1 |
| 45-∞s | 0 |

## Cut-kind census

| cut kind | count |
|---|---|
| detected-silence | 100 |
| excision-run-edge | 9 |
| corpus-end | 1 |

## The complete violation list (not a summary)

Total violation events: **28**.

| # | cause | segIdx | ideal | seam | dur | what the planner did |
|---|---|---|---|---|---|---|
| 0 | `oversize-unbreakable-group` | 308 | 916.694 | — | 18.058 | single unbreakable group spans 18.06s (segments 308-310); invariant 1 forbids splitting a sentence regardless of the 15s cap, so the cap is exceeded deliberately |
| 1 | `oversize-unbreakable-group` | 422 | 1340.260 | — | 16.091 | single unbreakable group spans 16.09s (segments 422-423); invariant 1 forbids splitting a sentence regardless of the 15s cap, so the cap is exceeded deliberately |
| 2 | `cap-exceeded` | 29 | 81.260 | 98.300 | 17.040 | emitted chunk spans 17.040s, over the 15s cap (segments 29-33); invariant 1 forbids the mid-sentence split that would avoid it |
| 3 | `cap-exceeded` | 38 | 108.920 | 125.250 | 16.330 | emitted chunk spans 16.330s, over the 15s cap (segments 38-40); invariant 1 forbids the mid-sentence split that would avoid it |
| 4 | `cap-exceeded` | 51 | 146.620 | 162.480 | 15.860 | emitted chunk spans 15.860s, over the 15s cap (segments 51-54); invariant 1 forbids the mid-sentence split that would avoid it |
| 5 | `cap-exceeded` | 57 | 174.240 | 189.560 | 15.320 | emitted chunk spans 15.320s, over the 15s cap (segments 57-63); invariant 1 forbids the mid-sentence split that would avoid it |
| 6 | `cap-exceeded` | 64 | 189.560 | 205.080 | 15.520 | emitted chunk spans 15.520s, over the 15s cap (segments 64-69); invariant 1 forbids the mid-sentence split that would avoid it |
| 7 | `cap-exceeded` | 74 | 216.540 | 232.200 | 15.660 | emitted chunk spans 15.660s, over the 15s cap (segments 74-79); invariant 1 forbids the mid-sentence split that would avoid it |
| 8 | `cap-exceeded` | 80 | 232.200 | 249.500 | 17.300 | emitted chunk spans 17.300s, over the 15s cap (segments 80-83); invariant 1 forbids the mid-sentence split that would avoid it |
| 9 | `cap-exceeded` | 121 | 352.400 | 369.750 | 17.350 | emitted chunk spans 17.350s, over the 15s cap (segments 121-123); invariant 1 forbids the mid-sentence split that would avoid it |
| 10 | `cap-exceeded` | 171 | 498.520 | 521.250 | 22.730 | emitted chunk spans 22.730s, over the 15s cap (segments 171-174); invariant 1 forbids the mid-sentence split that would avoid it |
| 11 | `excision-collapsed-chunk` | 175 | 518.986 | 519.080 | -6.740 | window collapsed to [525.820, 519.080] because an excised run left the cursor past this chunk's own seam; segments 175-179 carried forward into the next emitted chunk rather than dropped, and the cursor held rather than moved back |
| 12 | `cap-exceeded` | 202 | 571.360 | 586.500 | 15.140 | emitted chunk spans 15.140s, over the 15s cap (segments 202-205); invariant 1 forbids the mid-sentence split that would avoid it |
| 13 | `cap-exceeded` | 219 | 630.620 | 663.630 | 33.010 | emitted chunk spans 33.010s, over the 15s cap (segments 219-222); invariant 1 forbids the mid-sentence split that would avoid it |
| 14 | `excision-collapsed-chunk` | 223 | 657.411 | 659.820 | -6.790 | window collapsed to [666.610, 659.820] because an excised run left the cursor past this chunk's own seam; segments 223-228 carried forward into the next emitted chunk rather than dropped, and the cursor held rather than moved back |
| 15 | `cap-exceeded` | 263 | 759.760 | 787.850 | 28.090 | emitted chunk spans 28.090s, over the 15s cap (segments 263-264); invariant 1 forbids the mid-sentence split that would avoid it |
| 16 | `excision-collapsed-chunk` | 265 | 778.622 | 779.960 | -11.980 | window collapsed to [791.940, 779.960] because an excised run left the cursor past this chunk's own seam; segments 265-266 carried forward into the next emitted chunk rather than dropped, and the cursor held rather than moved back |
| 17 | `cap-exceeded` | 271 | 794.920 | 812.880 | 17.960 | emitted chunk spans 17.960s, over the 15s cap (segments 271-275); invariant 1 forbids the mid-sentence split that would avoid it |
| 18 | `cap-exceeded` | 291 | 856.860 | 873.360 | 16.500 | emitted chunk spans 16.500s, over the 15s cap (segments 291-295); invariant 1 forbids the mid-sentence split that would avoid it |
| 19 | `cap-exceeded` | 304 | 901.120 | 924.500 | 23.380 | emitted chunk spans 23.380s, over the 15s cap (segments 304-305); invariant 1 forbids the mid-sentence split that would avoid it |
| 20 | `excision-collapsed-chunk` | 306 | 916.694 | 916.500 | -12.830 | window collapsed to [929.330, 916.500] because an excised run left the cursor past this chunk's own seam; segments 306-307 carried forward into the next emitted chunk rather than dropped, and the cursor held rather than moved back |
| 21 | `cap-exceeded` | 311 | 936.440 | 951.640 | 15.200 | emitted chunk spans 15.200s, over the 15s cap (segments 311-314); invariant 1 forbids the mid-sentence split that would avoid it |
| 22 | `cap-exceeded` | 327 | 1000.320 | 1016.320 | 16.000 | emitted chunk spans 16.000s, over the 15s cap (segments 327-333); invariant 1 forbids the mid-sentence split that would avoid it |
| 23 | `cap-exceeded` | 338 | 1029.040 | 1044.470 | 15.430 | emitted chunk spans 15.430s, over the 15s cap (segments 338-338); invariant 1 forbids the mid-sentence split that would avoid it |
| 24 | `cap-exceeded` | 379 | 1168.180 | 1188.050 | 19.870 | emitted chunk spans 19.870s, over the 15s cap (segments 379-381); invariant 1 forbids the mid-sentence split that would avoid it |
| 25 | `cap-exceeded` | 411 | 1314.460 | 1329.660 | 15.200 | emitted chunk spans 15.200s, over the 15s cap (segments 411-417); invariant 1 forbids the mid-sentence split that would avoid it |
| 26 | `cap-exceeded` | 422 | 1340.720 | 1355.880 | 15.160 | emitted chunk spans 15.160s, over the 15s cap (segments 422-423); invariant 1 forbids the mid-sentence split that would avoid it |
| 27 | `cap-exceeded` | 424 | 1355.880 | 1371.500 | 15.620 | emitted chunk spans 15.620s, over the 15s cap (segments 424-429); invariant 1 forbids the mid-sentence split that would avoid it |

## The period-detection census

- v6 segments: **447** | period-strict sentence ends: **368** | unbreakable groups: **368**
- terminator census (accepted): `{".":368}`
- rejection census: `{"no-terminator":79}`
- **segments where the period-strict rule DISAGREES with `s2EndsSentence`: 0**

### Ambiguous-case hunt (whole segment text, not just its final character)

| class the brief names | anywhere in text | at segment-final position | resolution |
|---|---|---|---|
| ellipsis (… or ...) | 0 | **0** | STRUCTURALLY ABSENT from v6 anywhere — the exclusion is inert on this corpus |
| decimal (digit.digit) | 0 | **0** | STRUCTURALLY ABSENT from v6 anywhere — the exclusion is inert on this corpus |
| any digit | 0 | **0** | STRUCTURALLY ABSENT from v6 anywhere — the exclusion is inert on this corpus |
| abbreviation (closed list) | 0 | **0** | STRUCTURALLY ABSENT from v6 anywhere — the exclusion is inert on this corpus |
| single-capital initial (X.) | 0 | **0** | STRUCTURALLY ABSENT from v6 anywhere — the exclusion is inert on this corpus |
| quote or bracket | 16 | **0** | present INSIDE segment text but NEVER at the segment-final position the rule reads, so it cannot change a verdict; the exclusion is inert on this corpus |
| colon or semicolon | 0 | **0** | STRUCTURALLY ABSENT from v6 anywhere — the exclusion is inert on this corpus |
| exclamation or question mark | 0 | **0** | STRUCTURALLY ABSENT from v6 anywhere — the exclusion is inert on this corpus |

#### quote or bracket — 16 segment(s), 0 at a segment-final position

- segment **36**: `Certain men sleep closest to the fire’s edge.`
- segment **63**: `ntil you have the torch burning again from the second carrier’s coals.`
- segment **96**: `A predator’s presence reaches your nose before your mind names it.`
- segment **127**: `fire so your eyes can adjust fully to the dark beyond the camp’s edge.`
- segment **128**: `he fire’s warmth is on your back and the night’s cold is on your face.`
- segment **166**: `drawn by the smell of the previous day’s butchering.`
- segment **219**: `There is a space between your action and something else’s action`
- segment **254**: `You remember Daret’s hand on your shoulder over the dropped torch.`
- segment **267**: ` one morning when a girl of about nine walks to you at the fire’s edge`
- segment **319**: ` the body’s warning triggers a second signal that overrides the first.`
- segment **377**: `sitting at someone else’s fire at their age`
- segment **386**: `pped back from active perimeter work and gave it fully to Fen’s people`
- segment **394**: `scribe what Daret’s hand felt like on your shoulder and what it meant.`
- segment **398**: `me slowing his feet made a difference he could feel in his whole body.`
- segment **411**: `Fen’s youngest scout`
- segment **430**: `Somewhere right now a child is pressed against their mother’s side.`

